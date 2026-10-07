// CapacitorProjectFs can't run on a real device in CI, so this drives it
// against an in-memory fake of the @capacitor/filesystem plugin API
// (readdir/stat/readFile/writeFile/mkdir/rmdir/deleteFile/rename, base64 data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapacitorProjectFs, bytesToBase64, base64ToBytes } from '../../src/storage/capacitorFs.js';

function fakePlugin() {
  const files = new Map(); // full path -> {data: base64, mtime}
  const dirs = new Set(['Projects', 'Projects/site']);
  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const nf = (p) => { throw new Error(`File does not exist: ${p}`); };
  return {
    files, dirs,
    async readdir({ path }) {
      if (!dirs.has(path)) nf(path);
      const out = [];
      for (const d of dirs) if (parent(d) === path) out.push({ name: d.split('/').pop(), type: 'directory' });
      for (const [f] of files) if (parent(f) === path) out.push({ name: f.split('/').pop(), type: 'file' });
      return { files: out };
    },
    async stat({ path }) {
      if (dirs.has(path)) return { type: 'directory', size: 0, mtime: 1 };
      const f = files.get(path);
      if (!f) nf(path);
      return { type: 'file', size: base64ToBytes(f.data).length, mtime: f.mtime };
    },
    async readFile({ path }) { const f = files.get(path); if (!f) nf(path); return { data: f.data }; },
    async writeFile({ path, data }) {
      if (!dirs.has(parent(path))) nf(parent(path));
      files.set(path, { data, mtime: Date.now() });
      return { uri: 'file:///' + path };
    },
    async mkdir({ path, recursive }) {
      if (dirs.has(path)) throw new Error('Directory exists');
      if (!recursive && !dirs.has(parent(path))) nf(parent(path));
      let cur = '';
      for (const part of path.split('/')) { cur = cur ? `${cur}/${part}` : part; dirs.add(cur); }
    },
    async rmdir({ path, recursive }) {
      const children = [...dirs, ...files.keys()].filter((p) => p.startsWith(path + '/'));
      if (children.length && !recursive) throw new Error('Folder is not empty');
      for (const c of children) { dirs.delete(c); files.delete(c); }
      dirs.delete(path);
    },
    async deleteFile({ path }) { if (!files.delete(path)) nf(path); },
    async rename({ from, to }) {
      const f = files.get(from);
      if (f) { files.delete(from); files.set(to, f); return; }
      nf(from);
    },
  };
}

test('base64 helpers round-trip arbitrary bytes', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 31) & 255);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('CapacitorProjectFs maps ProjectFs calls onto the plugin', async () => {
  const plugin = fakePlugin();
  const fs = new CapacitorProjectFs(plugin, { rootPath: 'Projects/site', id: 'x' });
  await fs.createDir('src');
  await fs.writeBytes('src/app.js', new TextEncoder().encode('let a = 1;\n'));
  await fs.createFile('index.html', new TextEncoder().encode('<p>hi</p>'));
  assert.deepEqual((await fs.list('')).map((e) => `${e.kind}:${e.name}`), ['directory:src', 'file:index.html']);
  assert.equal(await fs.readText('src/app.js'), 'let a = 1;\n');
  assert.equal((await fs.stat('src/app.js')).kind, 'file');
  assert.equal(await fs.stat('missing.js'), null);
  await assert.rejects(fs.createFile('index.html'), { code: 'EEXIST' });
  await assert.rejects(fs.readBytes('nope.txt'), { code: 'ENOENT' });
  await fs.rename('index.html', 'home.html');
  assert.equal(await fs.exists('index.html'), false);
  assert.equal(await fs.readText('home.html'), '<p>hi</p>');
  await fs.delete('src');
  assert.equal(await fs.exists('src/app.js'), false);
  assert.equal(fs.realPath('a.js'), 'Projects/site/a.js');
  await assert.rejects(fs.delete(''), { code: 'EPERM' });
});
