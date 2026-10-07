// storage/projectFs.js — the ProjectFs seam (spec §4.2).
//
// Everything above this file (editor, git, search, preview) talks to ONE
// interface. Implementations:
//
//   HandleProjectFs     File System Access API handles. Covers two cases with
//                       the same code: a real folder from showDirectoryPicker()
//                       (desktop Chrome/Edge), and the browser's private
//                       Origin Private File System (OPFS) — which works inside
//                       Android Chrome and the Capacitor WebView, where folder
//                       pickers don't exist.
//   CapacitorProjectFs  storage/capacitorFs.js — real device paths through
//                       @capacitor/filesystem (spec Option B, all-files access).
//
// Paths are project-relative POSIX strings ("src/app.js"); "" is the root.
// Errors carry Node-style codes (ENOENT, EEXIST, ...) so callers — and
// isomorphic-git, which expects a Node-like fs — can branch on them.

import { dirname, basename } from '../core/paths.js';

export function fsError(code, message, cause) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function mapDomError(err, path) {
  if (err && err.code && /^E[A-Z]+$/.test(err.code)) return err;
  switch (err && err.name) {
    case 'NotFoundError': return fsError('ENOENT', `no such file or directory, '${path}'`, err);
    case 'TypeMismatchError': return fsError('ENOTDIR', `wrong entry type at '${path}'`, err);
    case 'InvalidModificationError': return fsError('ENOTEMPTY', `directory not empty, '${path}'`, err);
    case 'NotAllowedError':
    case 'SecurityError': return fsError('EACCES', `permission denied, '${path}'`, err);
    case 'QuotaExceededError': return fsError('ENOSPC', 'storage is full', err);
    default: return err;
  }
}

const splitPath = (path) => (path ? path.split('/').filter(Boolean) : []);

export function sortEntries(entries) {
  return entries.sort((a, b) => (a.kind === b.kind
    ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : a.kind === 'directory' ? -1 : 1));
}

export class HandleProjectFs {
  /**
   * @param {FileSystemDirectoryHandle} root
   * @param {{kind:'folder'|'browser', id:string}} meta
   */
  constructor(root, meta) {
    this.root = root;
    this.kind = meta.kind;
    this.id = meta.id;
    this.name = meta.name || root.name;
    this.dirCache = new Map([['', root]]);
  }

  get supportsRealPaths() { return false; }

  async _dir(path, create = false) {
    const cached = this.dirCache.get(path);
    if (cached) return cached;
    let handle = this.root;
    let cur = '';
    for (const part of splitPath(path)) {
      cur = cur ? `${cur}/${part}` : part;
      const hit = this.dirCache.get(cur);
      if (hit) { handle = hit; continue; }
      try {
        handle = await handle.getDirectoryHandle(part, { create });
      } catch (err) {
        throw mapDomError(err, cur);
      }
      this.dirCache.set(cur, handle);
    }
    return handle;
  }

  async _file(path, create = false) {
    const dir = await this._dir(dirname(path));
    try {
      return await dir.getFileHandle(basename(path), { create });
    } catch (err) {
      throw mapDomError(err, path);
    }
  }

  _forget(path) {
    for (const key of [...this.dirCache.keys()]) {
      if (key === path || key.startsWith(path + '/')) this.dirCache.delete(key);
    }
  }

  async list(dir = '') {
    const handle = await this._dir(dir);
    const out = [];
    try {
      for await (const [name, child] of handle.entries()) {
        out.push({ name, kind: child.kind, path: dir ? `${dir}/${name}` : name });
      }
    } catch (err) {
      throw mapDomError(err, dir);
    }
    return sortEntries(out);
  }

  /** @returns {Promise<{kind:'file'|'directory', size:number, lastModified:number}|null>} */
  async stat(path) {
    if (!path) return { kind: 'directory', size: 0, lastModified: 0 };
    let parent;
    try {
      parent = await this._dir(dirname(path));
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
      throw err;
    }
    const name = basename(path);
    try {
      const fh = await parent.getFileHandle(name);
      const file = await fh.getFile();
      return { kind: 'file', size: file.size, lastModified: file.lastModified };
    } catch (err) {
      if (err.name !== 'TypeMismatchError' && err.name !== 'NotFoundError') throw mapDomError(err, path);
      if (err.name === 'NotFoundError') return null;
    }
    try {
      await parent.getDirectoryHandle(name);
      return { kind: 'directory', size: 0, lastModified: 0 };
    } catch (err) {
      if (err.name === 'NotFoundError' || err.name === 'TypeMismatchError') return null;
      throw mapDomError(err, path);
    }
  }

  async exists(path) {
    return (await this.stat(path)) !== null;
  }

  async readBytes(path) {
    const fh = await this._file(path);
    try {
      const file = await fh.getFile();
      return { bytes: new Uint8Array(await file.arrayBuffer()), lastModified: file.lastModified, size: file.size };
    } catch (err) {
      throw mapDomError(err, path);
    }
  }

  async readText(path) {
    const { bytes } = await this.readBytes(path);
    return new TextDecoder().decode(bytes);
  }

  /** Writes (creating the file, but not missing parent folders). */
  async writeBytes(path, bytes) {
    const fh = await this._file(path, true);
    if (typeof fh.createWritable !== 'function') {
      throw fsError('ENOTSUP', 'this browser cannot write files here (no createWritable)');
    }
    try {
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      const file = await fh.getFile();
      return { lastModified: file.lastModified, size: file.size };
    } catch (err) {
      throw mapDomError(err, path);
    }
  }

  async createFile(path, bytes = new Uint8Array()) {
    if (await this.exists(path)) throw fsError('EEXIST', `file already exists, '${path}'`);
    return this.writeBytes(path, bytes);
  }

  async createDir(path, { recursive = false } = {}) {
    if (!recursive) {
      if (await this.exists(path)) throw fsError('EEXIST', `already exists, '${path}'`);
      await this._dir(dirname(path)); // parent must exist
    }
    await this._dir(path, true);
  }

  async delete(path, { recursive = true } = {}) {
    if (!path) throw fsError('EPERM', 'refusing to delete the project root');
    const parent = await this._dir(dirname(path));
    try {
      await parent.removeEntry(basename(path), { recursive });
    } catch (err) {
      throw mapDomError(err, path);
    }
    this._forget(path);
  }

  async rename(from, to) {
    if (from === to) return;
    if (await this.exists(to)) throw fsError('EEXIST', `'${to}' already exists`);
    const info = await this.stat(from);
    if (!info) throw fsError('ENOENT', `no such file or directory, '${from}'`);
    const handle = info.kind === 'file' ? await this._file(from) : await this._dir(from);
    if (typeof handle.move === 'function') {
      try {
        const target = await this._dir(dirname(to));
        await handle.move(target, basename(to));
        this._forget(from);
        return;
      } catch (err) {
        // Not supported for this kind of handle: fall back to copy + delete.
        if (!['NotSupportedError', 'TypeError', 'InvalidStateError', 'NotAllowedError'].includes(err.name)) throw mapDomError(err, from);
      }
    }
    await this.copy(from, to);
    await this.delete(from, { recursive: true });
  }

  async copy(from, to) {
    const info = await this.stat(from);
    if (!info) throw fsError('ENOENT', `no such file or directory, '${from}'`);
    if (info.kind === 'file') {
      const { bytes } = await this.readBytes(from);
      await this.writeBytes(to, bytes);
      return;
    }
    await this.createDir(to, { recursive: true });
    for (const child of await this.list(from)) {
      await this.copy(child.path, `${to}/${child.name}`);
    }
  }
}

/**
 * Walks the whole tree (for quick open, project search, zip export).
 * @param {(path:string, isDir:boolean)=>boolean} skip
 * @returns {Promise<string[]>} file paths
 */
export async function walkFiles(fs, { skip = () => false, limit = 20000, dir = '' } = {}) {
  const out = [];
  const queue = [dir];
  while (queue.length && out.length < limit) {
    const cur = queue.shift();
    let entries;
    try {
      entries = await fs.list(cur);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (skip(e.path, e.kind === 'directory', e.name)) continue;
      if (e.kind === 'directory') queue.push(e.path);
      else out.push(e.path);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function isFolderPickerSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function isOpfsSupported() {
  return typeof navigator !== 'undefined' && !!(navigator.storage && navigator.storage.getDirectory);
}
