// storage/capacitorFs.js — real device paths through @capacitor/filesystem.
//
// Spec §0.1 locks storage to "Option B: all-files access, PathProjectFs first".
// In a Capacitor build, this is that PathProjectFs: the project is an ordinary
// folder such as /storage/emulated/0/Projects/site, so other apps (Termux, a
// git client) see the same files.
//
// Requirements (see CAPACITOR_SETUP.md): `npm i @capacitor/filesystem`,
// `npx cap sync`, and MANAGE_EXTERNAL_STORAGE in AndroidManifest.xml on
// Android 11+. When the plugin isn't present (plain browser), nothing here is
// used — `getCapacitorFilesystem()` returns null.
//
// The plugin passes binary data as base64 strings over the JS↔native bridge,
// hence the helpers at the bottom.

import { fsError, sortEntries } from './projectFs.js';
import { dirname } from '../core/paths.js';

export function getCapacitorFilesystem() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  const plugin = cap && cap.Plugins && cap.Plugins.Filesystem;
  return plugin && cap.isNativePlatform && cap.isNativePlatform() ? plugin : null;
}

function mapError(err, path) {
  const msg = String((err && err.message) || err);
  if (/does not exist|not exist|no such file|ENOENT|not found/i.test(msg)) return fsError('ENOENT', `no such file or directory, '${path}'`, err);
  if (/already exists|EEXIST/i.test(msg)) return fsError('EEXIST', `already exists, '${path}'`, err);
  if (/not empty/i.test(msg)) return fsError('ENOTEMPTY', `directory not empty, '${path}'`, err);
  if (/permission|denied|EACCES/i.test(msg)) return fsError('EACCES', `permission denied, '${path}'`, err);
  return err;
}

export class CapacitorProjectFs {
  /**
   * @param {object} plugin   Capacitor Filesystem plugin
   * @param {{rootPath:string, directory?:string, id:string, name?:string}} opts
   *   rootPath is relative to `directory` (e.g. "Projects/site" in
   *   "EXTERNAL_STORAGE"), or an absolute "file:///…" path with no directory.
   */
  constructor(plugin, opts) {
    this.fs = plugin;
    this.rootPath = opts.rootPath.replace(/\/+$/, '');
    this.directory = opts.directory;
    this.kind = 'device';
    this.id = opts.id;
    this.name = opts.name || this.rootPath.split('/').pop() || 'device';
  }

  get supportsRealPaths() { return true; }

  _opts(path, extra = {}) {
    const full = path ? `${this.rootPath}/${path}` : this.rootPath;
    const o = { path: full, ...extra };
    if (this.directory) o.directory = this.directory;
    return o;
  }

  async list(dir = '') {
    let res;
    try {
      res = await this.fs.readdir(this._opts(dir));
    } catch (err) {
      throw mapError(err, dir);
    }
    const out = (res.files || []).map((f) => {
      const name = typeof f === 'string' ? f : f.name;
      const kind = typeof f === 'string' ? 'file' : (f.type === 'directory' ? 'directory' : 'file');
      return { name, kind, path: dir ? `${dir}/${name}` : name };
    });
    return sortEntries(out);
  }

  async stat(path) {
    try {
      const s = await this.fs.stat(this._opts(path));
      return { kind: s.type === 'directory' ? 'directory' : 'file', size: Number(s.size) || 0, lastModified: Number(s.mtime) || 0 };
    } catch (err) {
      const mapped = mapError(err, path);
      if (mapped.code === 'ENOENT') return null;
      throw mapped;
    }
  }

  async exists(path) {
    return (await this.stat(path)) !== null;
  }

  async readBytes(path) {
    let res;
    try {
      res = await this.fs.readFile(this._opts(path));
    } catch (err) {
      throw mapError(err, path);
    }
    const bytes = typeof res.data === 'string' ? base64ToBytes(res.data) : new Uint8Array(await res.data.arrayBuffer());
    const st = await this.stat(path);
    return { bytes, lastModified: st ? st.lastModified : Date.now(), size: bytes.length };
  }

  async readText(path) {
    return new TextDecoder().decode((await this.readBytes(path)).bytes);
  }

  async writeBytes(path, bytes) {
    try {
      await this.fs.writeFile(this._opts(path, { data: bytesToBase64(bytes), recursive: false }));
    } catch (err) {
      throw mapError(err, path);
    }
    const st = await this.stat(path);
    return { lastModified: st ? st.lastModified : Date.now(), size: bytes.length };
  }

  async createFile(path, bytes = new Uint8Array()) {
    if (await this.exists(path)) throw fsError('EEXIST', `file already exists, '${path}'`);
    return this.writeBytes(path, bytes);
  }

  async createDir(path, { recursive = false } = {}) {
    if (!recursive && (await this.exists(path))) throw fsError('EEXIST', `already exists, '${path}'`);
    try {
      await this.fs.mkdir(this._opts(path, { recursive }));
    } catch (err) {
      const mapped = mapError(err, path);
      if (!(recursive && mapped.code === 'EEXIST')) throw mapped;
    }
  }

  async delete(path, { recursive = true } = {}) {
    if (!path) throw fsError('EPERM', 'refusing to delete the project root');
    const st = await this.stat(path);
    if (!st) throw fsError('ENOENT', `no such file or directory, '${path}'`);
    try {
      if (st.kind === 'directory') await this.fs.rmdir(this._opts(path, { recursive }));
      else await this.fs.deleteFile(this._opts(path));
    } catch (err) {
      throw mapError(err, path);
    }
  }

  async rename(from, to) {
    if (from === to) return;
    if (await this.exists(to)) throw fsError('EEXIST', `'${to}' already exists`);
    const a = this._opts(from);
    const b = this._opts(to);
    const req = { from: a.path, to: b.path };
    if (this.directory) { req.directory = this.directory; req.toDirectory = this.directory; }
    try {
      await this.fs.rename(req);
    } catch (err) {
      throw mapError(err, from);
    }
  }

  async copy(from, to) {
    const st = await this.stat(from);
    if (!st) throw fsError('ENOENT', `no such file or directory, '${from}'`);
    if (st.kind === 'file') {
      await this.writeBytes(to, (await this.readBytes(from)).bytes);
      return;
    }
    await this.createDir(to, { recursive: true });
    for (const child of await this.list(from)) await this.copy(child.path, `${to}/${child.name}`);
  }

  /** Absolute path for tools that need one (shown in the UI / Termux bridge). */
  realPath(path = '') {
    return path ? `${this.rootPath}/${path}` : this.rootPath;
  }

  parentOf(path) { return dirname(path); }
}

export function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const clean = b64.replace(/^data:[^,]*,/, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
