// storage/trash.js — deleted files and folders wait here for 7 days
// (ROADMAP Phase 4), so a delete can be undone.
//
// A deleted entry is copied into its own small IndexedDB database (bytes of
// every file, and the folders, so empty ones come back too), then removed
// from the project. Restore writes it back where it was (or next to it, as
// "name copy", if that place was taken since). Entries older than 7 days are
// dropped when a project opens. Its own database, not a new store in the
// app's: adding a store means a version upgrade, which another open tab of
// the app can block — and with it the crash recovery that shares that
// database.

import { req } from './db.js';
import { dirname, basename, join } from '../core/paths.js';
import { expired, freeName } from '../core/explorer.js';

const DB_NAME = 'codeeditor-trash';
/** Bigger deletes are not kept (they would crowd the phone's storage): ask, then delete for good. */
export const TRASH_MAX_BYTES = 50 * 1024 * 1024;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const s = open.result.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
      s.createIndex('byProject', 'projectId');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

async function items(mode = 'readonly') {
  return (await openDb()).transaction('items', mode).objectStore('items');
}

/** Every file and folder under `path` (or `path` itself for a file). */
async function collect(fs, path, kind) {
  if (kind !== 'directory') return { files: [path], dirs: [] };
  const files = [];
  const dirs = [path];
  const queue = [path];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of await fs.list(cur)) {
      if (e.kind === 'directory') { dirs.push(e.path); queue.push(e.path); } else files.push(e.path);
    }
  }
  return { files, dirs };
}

/**
 * Copies `path` into the trash. Returns the entry's id, or null when it is
 * too big to keep (the caller then asks before deleting it for good).
 * Does not delete it from the project: the caller does, once this worked.
 */
export async function putInTrash(fs, projectId, path, kind) {
  const { files, dirs } = await collect(fs, path, kind);
  let size = 0;
  const saved = [];
  for (const f of files) {
    const { bytes } = await fs.readBytes(f);
    size += bytes.byteLength;
    if (size > TRASH_MAX_BYTES) return null;
    saved.push({ path: f, bytes });
  }
  const entry = { projectId, path, kind, name: basename(path), deletedAt: Date.now(), size, files: saved, dirs };
  return req((await items('readwrite')).add(entry));
}

/** The project's trash, newest first, without the file contents. */
export async function listTrash(projectId) {
  const all = await req((await items()).index('byProject').getAll(projectId));
  return all.map(({ files, ...meta }) => ({ ...meta, count: files.length })).sort((a, b) => b.deletedAt - a.deletedAt);
}

/**
 * Puts an entry back. Where it was, or next to it with a free name if that
 * place is taken now. Returns the path it was restored to.
 */
export async function restoreFromTrash(fs, id) {
  const entry = await req((await items()).get(id));
  if (!entry) throw new Error('Not in the trash any more.');
  const parent = dirname(entry.path);
  const name = freeName(parent, basename(entry.path), await takenSet(fs, parent));
  const to = join(parent, name);
  const moved = (p) => to + p.slice(entry.path.length);
  if (parent) await fs.createDir(parent, { recursive: true });
  for (const d of entry.dirs) await fs.createDir(moved(d), { recursive: true });
  for (const f of entry.files) {
    const dest = moved(f.path);
    if (dirname(dest)) await fs.createDir(dirname(dest), { recursive: true });
    await fs.writeBytes(dest, f.bytes);
  }
  await deleteFromTrash(id);
  return to;
}

async function takenSet(fs, dir) {
  let names = [];
  try { names = (await fs.list(dir)).map((e) => e.path); } catch { /* the folder is gone too */ }
  const set = new Set(names);
  return (p) => set.has(p);
}

export async function deleteFromTrash(id) {
  return req((await items('readwrite')).delete(id));
}

/** Drops what has been in the trash for more than 7 days. Returns how many. */
export async function purgeTrash(projectId, now = Date.now()) {
  const old = expired(await listTrash(projectId), now);
  for (const e of old) await deleteFromTrash(e.id);
  return old.length;
}
