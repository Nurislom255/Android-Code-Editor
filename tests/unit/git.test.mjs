// Drives GitService + the fs adapter against a Node-backed ProjectFs, then
// checks the result with the real `git` CLI — proving the adapter produces a
// repository that standard git understands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitService } from '../../src/git/gitService.js';
import { fsError, sortEntries } from '../../src/storage/projectFs.js';

/** Minimal ProjectFs over node:fs with the same error codes as the browser ones. */
class NodeProjectFs {
  constructor(root) { this.root = root; }
  abs(p) { return path.join(this.root, p); }
  async list(dir = '') {
    const names = await fs.readdir(this.abs(dir), { withFileTypes: true });
    return sortEntries(names.map((d) => ({ name: d.name, kind: d.isDirectory() ? 'directory' : 'file', path: dir ? `${dir}/${d.name}` : d.name })));
  }
  async stat(p) {
    try {
      const s = await fs.stat(this.abs(p));
      return { kind: s.isDirectory() ? 'directory' : 'file', size: s.size, lastModified: Math.floor(s.mtimeMs) };
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async exists(p) { return (await this.stat(p)) !== null; }
  async readBytes(p) {
    try { return { bytes: new Uint8Array(await fs.readFile(this.abs(p))) }; } catch (e) { throw fsError(e.code, e.message); }
  }
  async writeBytes(p, bytes) {
    try { await fs.writeFile(this.abs(p), bytes); } catch (e) { throw fsError(e.code, e.message); }
    return { lastModified: Date.now(), size: bytes.length };
  }
  async createDir(p, { recursive = false } = {}) {
    try { await fs.mkdir(this.abs(p), { recursive }); } catch (e) { throw fsError(e.code, e.message); }
  }
  async delete(p, { recursive = true } = {}) {
    try {
      const s = await fs.stat(this.abs(p));
      if (s.isDirectory()) await fs.rm(this.abs(p), { recursive });
      else await fs.unlink(this.abs(p));
    } catch (e) { throw fsError(e.code, e.message); }
  }
}

const enc = (s) => new TextEncoder().encode(s);
// Like real editing: changes don't land in the same millisecond as `git add`
// (git's stat cache has millisecond resolution here, as in the browser).
const tick = () => new Promise((r) => setTimeout(r, 15));
const author = { name: 'Test User', email: 'test@example.com' };

test('init, status, stage, commit, branch, checkout, readHead', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-git-'));
  const pfs = new NodeProjectFs(dir);
  const g = new GitService(pfs);
  assert.equal(await g.isRepo(), false);
  await g.init();
  assert.equal(await g.isRepo(), true);

  await pfs.writeBytes('index.html', enc('<h1>hi</h1>\n'));
  await pfs.createDir('src');
  await pfs.writeBytes('src/app.js', enc('console.log(1);\n'));
  await pfs.writeBytes('.gitignore', enc('*.log\n'));
  await pfs.writeBytes('debug.log', enc('ignored'));

  let st = await g.status();
  assert.deepEqual(st.map((e) => [e.path, e.staged, e.unstaged]), [
    ['.gitignore', null, 'U'], ['index.html', null, 'U'], ['src/app.js', null, 'U'],
  ], 'ignored files are not listed');

  await g.stageAll(st);
  st = await g.status();
  assert.ok(st.every((e) => e.staged === 'A' && e.unstaged === null));
  const oid = await g.commit('first commit', author);
  assert.match(oid, /^[0-9a-f]{40}$/);
  assert.deepEqual(await g.status(), []);

  // modify + delete, unstaged
  await tick();
  await pfs.writeBytes('src/app.js', enc('console.log(2);\n'));
  await pfs.delete('index.html');
  st = await g.status();
  assert.deepEqual(st.map((e) => [e.path, e.staged, e.unstaged]), [['index.html', null, 'D'], ['src/app.js', null, 'M']]);
  assert.equal(await g.readHead('src/app.js'), 'console.log(1);\n');

  await g.stage('index.html');
  await g.stage('src/app.js');
  st = await g.status();
  assert.deepEqual(st.map((e) => [e.path, e.staged, e.unstaged]), [['index.html', 'D', null], ['src/app.js', 'M', null]]);
  await g.unstage('src/app.js');
  st = await g.status();
  assert.deepEqual(st.find((e) => e.path === 'src/app.js'), { path: 'src/app.js', staged: null, unstaged: 'M' });
  await g.stage('src/app.js');
  await g.commit('second', author);

  await g.createBranch('feature', true);
  assert.equal(await g.currentBranch(), 'feature');
  await tick();
  await pfs.writeBytes('feature.txt', enc('x\n'));
  await g.stage('feature.txt');
  await g.commit('feature work', author);
  await g.checkout('main');
  assert.equal(await pfs.exists('feature.txt'), false, 'checkout removes files of the other branch');
  const { list, current } = await g.branches();
  assert.deepEqual(list.sort(), ['feature', 'main']);
  assert.equal(current, 'main');

  const log = await g.log();
  assert.deepEqual(log.map((c) => c.commit.message.trim()), ['second', 'first commit']);

  // The real git CLI agrees with what we wrote.
  const cli = execFileSync('git', ['-C', dir, 'log', '--format=%s', 'main'], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(cli, ['second', 'first commit']);
  const fsck = execFileSync('git', ['-C', dir, 'fsck', '--strict'], { encoding: 'utf8' });
  assert.equal(typeof fsck, 'string');

  // discard working-tree changes
  await tick();
  await pfs.writeBytes('src/app.js', enc('oops\n'));
  await g.discard('src/app.js', { unstaged: 'M' });
  assert.equal(new TextDecoder().decode((await pfs.readBytes('src/app.js')).bytes), 'console.log(2);\n');

  await fs.rm(dir, { recursive: true, force: true });
});

test('racy clean: an edit right after staging (same size, same second) is still detected', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-git-racy-'));
  const pfs = new NodeProjectFs(dir);
  const g = new GitService(pfs);
  await g.init();
  await pfs.writeBytes('a.txt', enc('one\n'));
  await g.stage('a.txt');
  await g.commit('c1', author);
  await pfs.writeBytes('a.txt', enc('two\n')); // no delay, same length
  assert.deepEqual(await g.status(), [{ path: 'a.txt', staged: null, unstaged: 'M' }]);
  await fs.rm(dir, { recursive: true, force: true });
});
