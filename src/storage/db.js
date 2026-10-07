// storage/db.js — one small IndexedDB database for everything that must
// survive the app being killed (spec §3.4, §4.9):
//
//   kv        misc values (structured-clone: folder handles can be stored here,
//             which localStorage — strings only — can't do)
//   recovery  dirty-buffer mirrors, keyed by document key
//   history   local-history snapshots (spec §2 Phase 2)
//   projects  known projects (folder handles / browser projects / device paths)
//
// IndexedDB's API is callback-based; `req()` wraps a request in a Promise —
// the same move as `util.promisify` in Node or wrapping a callback in
// `new Promise(...)` in plain JS.

const DB_NAME = 'codeeditor';
const DB_VERSION = 1;

let dbPromise = null;

export function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('history')) {
        const h = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        h.createIndex('byDoc', 'docKey');
        h.createIndex('byTime', 'time');
      }
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Database upgrade blocked by another open tab'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

async function store(name, mode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export const kv = {
  async get(key) { return req((await store('kv')).get(key)); },
  async set(key, value) { return req((await store('kv', 'readwrite')).put(value, key)); },
  async delete(key) { return req((await store('kv', 'readwrite')).delete(key)); },
};

export async function getAll(name) {
  return req((await store(name)).getAll());
}

export async function put(name, value) {
  return req((await store(name, 'readwrite')).put(value));
}

export async function del(name, key) {
  return req((await store(name, 'readwrite')).delete(key));
}

export async function get(name, key) {
  return req((await store(name)).get(key));
}

export async function storeHandle(name, mode) {
  return store(name, mode);
}
