// storage/localHistory.js — a snapshot of the file on every save, kept for N
// days, independent of git (spec §2 Phase 2). Lets you recover "the version
// from an hour ago" even in a folder that isn't a repository.

import { openDb, req } from './db.js';

export class LocalHistory {
  constructor({ days = 7, maxPerFile = 40 } = {}) {
    this.days = days;
    this.maxPerFile = maxPerFile;
  }

  configure({ days, maxPerFile }) {
    if (days) this.days = days;
    if (maxPerFile) this.maxPerFile = maxPerFile;
  }

  /** Stores a snapshot unless it's identical to the newest one for this file.
   * Calls are serialized: the "identical to newest?" check must see the
   * previous snapshot's write. */
  snapshot(docKey, path, content, label = 'Saved') {
    this.queue = (this.queue || Promise.resolve()).then(() => this._snapshot(docKey, path, content, label));
    return this.queue;
  }

  async _snapshot(docKey, path, content, label) {
    try {
      const list = await this.list(docKey);
      if (list.length && list[0].content === content) return false;
      const db = await openDb();
      const tx = db.transaction('history', 'readwrite');
      const st = tx.objectStore('history');
      st.add({ docKey, path, content, time: Date.now(), size: content.length, label });
      // Trim to maxPerFile (oldest first).
      for (const old of list.slice(this.maxPerFile - 1)) st.delete(old.id);
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      return true;
    } catch (err) {
      console.warn('local history snapshot failed', err);
      return false;
    }
  }

  /** Newest first. */
  async list(docKey) {
    const db = await openDb();
    const idx = db.transaction('history').objectStore('history').index('byDoc');
    const rows = await req(idx.getAll(docKey));
    return rows.sort((a, b) => b.time - a.time);
  }

  async prune() {
    const cutoff = Date.now() - this.days * 86400000;
    try {
      const db = await openDb();
      const tx = db.transaction('history', 'readwrite');
      const idx = tx.objectStore('history').index('byTime');
      const range = IDBKeyRange.upperBound(cutoff);
      await new Promise((resolve, reject) => {
        const cur = idx.openCursor(range);
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) { resolve(); return; }
          c.delete();
          c.continue();
        };
        cur.onerror = () => reject(cur.error);
      });
    } catch (err) {
      console.warn('local history prune failed', err);
    }
  }

  /** Keeps history attached to a file after rename. */
  async rekey(oldKey, newKey, newPath) {
    const db = await openDb();
    const rows = await this.list(oldKey);
    const tx = db.transaction('history', 'readwrite');
    const st = tx.objectStore('history');
    for (const r of rows) st.put({ ...r, docKey: newKey, path: newPath });
    await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
  }
}
