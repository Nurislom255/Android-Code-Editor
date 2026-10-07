// git/fsAdapter.js — makes a ProjectFs look like Node's `fs.promises`, which
// is what isomorphic-git expects. Git then works on exactly the same files the
// editor shows (spec §4.4: JGit's role, played by isomorphic-git on the web).

import { fsError } from '../storage/projectFs.js';
import { normalize } from '../core/paths.js';

// git passes absolute paths like "/.git/HEAD" and sometimes "/."; the File
// System Access API rejects "." as a name, so collapse . and .. first.
const rel = (p) => normalize(String(p)) ?? '';

function pathIno(path) {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (Math.imul(h, 31) + path.charCodeAt(i)) | 0;
  return h >>> 0;
}

// isomorphic-git decides "unchanged" by comparing stat fields at whole-second
// resolution. A file staged and then edited within the same second (same
// size) would look unchanged — git's "racy clean" problem. Real git re-hashes
// such files; we get the same effect by giving recently modified files an ino
// that never matches the index, which forces a content hash.
const RACY_MS = 3000;
let racyCounter = 0;

function makeStat(path, st) {
  const isDir = st.kind === 'directory';
  const ms = st.lastModified || 0;
  const racy = !isDir && Date.now() - ms < RACY_MS;
  return {
    type: isDir ? 'dir' : 'file',
    mode: isDir ? 0o40000 : 0o100644,
    size: st.size || 0,
    ino: racy ? (pathIno(path) ^ Math.imul(++racyCounter, 2654435761)) >>> 0 : pathIno(path),
    dev: 1, uid: 1, gid: 1,
    mtimeMs: ms, ctimeMs: ms,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
  };
}

export function gitFs(projectFs) {
  const promises = {
    async readFile(path, opts) {
      const { bytes } = await projectFs.readBytes(rel(path));
      const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
      return enc === 'utf8' || enc === 'utf-8' ? new TextDecoder().decode(bytes) : bytes;
    },
    async writeFile(path, data, opts) {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength ?? data.length);
      await projectFs.writeBytes(rel(path), bytes);
    },
    async mkdir(path) {
      await projectFs.createDir(rel(path), { recursive: false });
    },
    async rmdir(path) {
      const p = rel(path);
      const entries = await projectFs.list(p);
      if (entries.length) throw fsError('ENOTEMPTY', `directory not empty, '${p}'`);
      await projectFs.delete(p, { recursive: false });
    },
    async unlink(path) {
      const p = rel(path);
      const st = await projectFs.stat(p);
      if (!st) throw fsError('ENOENT', `no such file, '${p}'`);
      if (st.kind === 'directory') throw fsError('EISDIR', `is a directory, '${p}'`);
      await projectFs.delete(p, { recursive: false });
    },
    async stat(path) {
      const p = rel(path);
      const st = await projectFs.stat(p);
      if (!st) throw fsError('ENOENT', `no such file or directory, '${p}'`);
      return makeStat(p, st);
    },
    async lstat(path) {
      return promises.stat(path);
    },
    async readdir(path) {
      const p = rel(path);
      const st = await projectFs.stat(p);
      if (!st) throw fsError('ENOENT', `no such directory, '${p}'`);
      if (st.kind !== 'directory') throw fsError('ENOTDIR', `not a directory, '${p}'`);
      return (await projectFs.list(p)).map((e) => e.name);
    },
    async readlink(path) {
      throw fsError('ENOTSUP', `symlinks are not supported here ('${rel(path)}')`);
    },
    async symlink(target, path) {
      // Store the link as a small text file so checkout doesn't fail outright.
      await projectFs.writeBytes(rel(path), new TextEncoder().encode(target));
    },
    async chmod() {},
  };
  return { promises };
}
