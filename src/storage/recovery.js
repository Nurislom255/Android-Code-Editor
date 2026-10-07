// storage/recovery.js — hot-exit / unsaved-buffer recovery (spec §3.4).
//
// Android kills background apps to reclaim memory. A ViewModel (or here: the
// JS heap) doesn't survive that, and the saved-instance Bundle is far too
// small for file contents. So, ~1.5 s after typing stops, every dirty buffer
// is mirrored to IndexedDB. On start, mirrored buffers come back as unsaved
// tabs. Saving (or discarding) a file deletes its mirror.
//
// The debounce matters for battery and for typing latency: writing to
// IndexedDB on every keystroke would be wasted work.

import { put, del, getAll } from './db.js';

export const RECOVERY_DELAY_MS = 1500;

export class RecoveryStore {
  constructor({ delay = RECOVERY_DELAY_MS } = {}) {
    this.delay = delay;
    this.timers = new Map();
    this.pending = new Map(); // key -> () => entry
  }

  /**
   * Schedules a mirror write. `snapshot` is called when the timer fires so the
   * entry reflects the latest text, not the text at schedule time.
   */
  schedule(key, snapshot) {
    this.pending.set(key, snapshot);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.flush(key), this.delay));
  }

  async flush(key) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    const snapshot = this.pending.get(key);
    this.pending.delete(key);
    if (!snapshot) return;
    const entry = snapshot();
    if (!entry) return; // became clean meanwhile
    try {
      await put('recovery', { ...entry, key, updatedAt: Date.now() });
    } catch (err) {
      console.warn('recovery write failed', err);
    }
  }

  /** Writes everything now — called on visibilitychange → hidden / pagehide. */
  async flushAll() {
    await Promise.all([...this.pending.keys()].map((k) => this.flush(k)));
  }

  async remove(key) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.pending.delete(key);
    try { await del('recovery', key); } catch { /* not fatal */ }
  }

  async all() {
    try { return await getAll('recovery'); } catch { return []; }
  }
}
