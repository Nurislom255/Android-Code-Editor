// git/gitService.js — the git operations the Source Control panel needs.
// Loaded lazily (dynamic import) so isomorphic-git's ~300 KB only download
// when you open the git panel.
//
// Local operations (status, stage, commit, branches, log, diff) work offline.
// Push/pull/clone need the network AND, in a browser, a CORS proxy: GitHub's
// git endpoints don't send CORS headers, so a web page can't call them
// directly. The proxy URL is a setting; leave push/pull unused if you'd rather
// not route traffic through one.

import './bufferShim.js';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { gitFs } from './fsAdapter.js';

const DIR = '/';

export class GitService {
  constructor(projectFs) {
    this.pfs = projectFs;
    this.fs = gitFs(projectFs);
    this.cache = {};
  }

  base(extra = {}) {
    return { fs: this.fs, dir: DIR, cache: this.cache, ...extra };
  }

  resetCache() { this.cache = {}; }

  async isRepo() {
    return !!(await this.pfs.stat('.git'));
  }

  async init(defaultBranch = 'main') {
    await git.init(this.base({ defaultBranch }));
  }

  async currentBranch() {
    try { return (await git.currentBranch(this.base({ fullname: false }))) || null; } catch { return null; }
  }

  /**
   * @returns {Promise<{path:string, staged:string|null, unstaged:string|null}[]>}
   *  staged / unstaged: 'A' added, 'M' modified, 'D' deleted, 'U' untracked
   */
  async status() {
    const matrix = await git.statusMatrix(this.base());
    const out = [];
    for (const [path, head, work, stage] of matrix) {
      if (head === 1 && work === 1 && stage === 1) continue; // unmodified
      let staged = null, unstaged = null;
      // index vs HEAD
      if (head === 0 && (stage === 2 || stage === 3)) staged = 'A';
      else if (head === 1 && stage === 0) staged = 'D';
      else if (head === 1 && (stage === 2 || stage === 3)) staged = 'M';
      // working tree vs index
      if (stage === 0 && work === 2) unstaged = 'U';
      else if (stage === 0 && work === 1 && head === 1) unstaged = 'U';
      else if (stage !== 0 && work === 0) unstaged = 'D';
      else if ((stage === 1 && work === 2) || stage === 3) unstaged = 'M';
      if (staged || unstaged) out.push({ path, staged, unstaged });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async stage(path) {
    const exists = await this.pfs.exists(path);
    if (exists) await git.add(this.base({ filepath: path }));
    else await git.remove(this.base({ filepath: path }));
  }

  async stageAll(entries) {
    for (const e of entries) if (e.unstaged) await this.stage(e.path);
  }

  async unstage(path) {
    await git.resetIndex(this.base({ filepath: path }));
  }

  /** Throws away working-tree changes to one file (restores the index/HEAD version). */
  async discard(path, entry) {
    if (entry && entry.unstaged === 'U' && !entry.staged) {
      await this.pfs.delete(path);
      return;
    }
    await git.checkout(this.base({ filepaths: [path], force: true }));
  }

  async commit(message, author) {
    return git.commit(this.base({ message, author: { name: author.name, email: author.email } }));
  }

  async log(depth = 50) {
    try {
      return await git.log(this.base({ depth }));
    } catch (err) {
      if (err.code === 'NotFoundError') return []; // no commits yet
      throw err;
    }
  }

  async branches() {
    const list = await git.listBranches(this.base());
    return { current: await this.currentBranch(), list };
  }

  async createBranch(name, checkout = true) {
    await git.branch(this.base({ ref: name, checkout }));
  }

  /** Switches branch; refuses (CheckoutConflictError) if it would overwrite local changes. */
  async checkout(ref) {
    await git.checkout(this.base({ ref }));
    this.resetCache();
  }

  /** The committed (HEAD) text of a file, or null if it isn't in HEAD. */
  async readHead(path) {
    try {
      const oid = await git.resolveRef(this.base({ ref: 'HEAD' }));
      const { blob } = await git.readBlob(this.base({ oid, filepath: path }));
      return new TextDecoder().decode(blob).replace(/\r\n?/g, '\n');
    } catch {
      return null;
    }
  }

  async readIndexOrHead(path) {
    // The staged version if any, else HEAD — what "unstaged changes" compare to.
    try {
      const entries = await git.walk(this.base({
        trees: [git.STAGE()],
        map: async (filepath, [entry]) => (filepath === path && entry ? entry : undefined),
      }));
      const e = entries && entries[0];
      if (e) {
        const content = await e.content();
        if (content) return new TextDecoder().decode(content).replace(/\r\n?/g, '\n');
      }
    } catch { /* fall back */ }
    return this.readHead(path);
  }

  async remotes() {
    try { return await git.listRemotes(this.base()); } catch { return []; }
  }

  async addRemote(remote, url) {
    await git.addRemote(this.base({ remote, url, force: true }));
  }

  netOptions({ corsProxy, auth, onProgress }) {
    return {
      http,
      corsProxy: corsProxy || undefined,
      onAuth: auth ? () => auth : undefined,
      onAuthFailure: () => ({ cancel: true }),
      onProgress,
    };
  }

  async push({ remote = 'origin', corsProxy, auth, onProgress }) {
    return git.push(this.base({ remote, ...this.netOptions({ corsProxy, auth, onProgress }) }));
  }

  async pull({ remote = 'origin', corsProxy, auth, author, onProgress }) {
    const ref = await this.currentBranch();
    await git.pull(this.base({ remote, ref, singleBranch: true, author, fastForward: true, ...this.netOptions({ corsProxy, auth, onProgress }) }));
    this.resetCache();
  }

  async fetch({ remote = 'origin', corsProxy, auth, onProgress }) {
    return git.fetch(this.base({ remote, ...this.netOptions({ corsProxy, auth, onProgress }) }));
  }

  /** Clones into the (empty) project this service was created for. */
  async clone({ url, corsProxy, auth, onProgress, depth = 50 }) {
    await git.clone(this.base({ url, depth, singleBranch: true, ...this.netOptions({ corsProxy, auth, onProgress }) }));
    this.resetCache();
  }
}

export { git };
