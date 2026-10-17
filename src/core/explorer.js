// core/explorer.js — pure helpers for the file explorer (no DOM, no storage):
// free names for pasted copies, which selected entries actually act,
// shift-ranges, the filter, and how long the trash keeps things.

import { dirname, basename, join } from './paths.js';

export const TRASH_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/**
 * A name in `dir` that isn't taken: "a.js", then "a copy.js", "a copy 2.js"…
 * (never overwrite). `taken(path)` says whether a path exists.
 */
export function freeName(dir, name, taken) {
  if (!taken(join(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 1; ; i++) {
    const candidate = `${stem} copy${i === 1 ? '' : ` ${i}`}${ext}`;
    if (!taken(join(dir, candidate))) return candidate;
  }
}

/** Drops paths inside another selected folder: acting on the folder covers them. */
export function topLevel(paths) {
  const sorted = [...new Set(paths)].sort();
  const out = [];
  for (const p of sorted) if (!out.some((q) => p === q || p.startsWith(q + '/'))) out.push(p);
  return out;
}

/** Whether `path` may go into folder `dir` (not into itself or below itself, not where it already is). */
export function canMoveInto(path, dir) {
  if (dir === path || dir.startsWith(path + '/')) return false;
  return dirname(path) !== dir;
}

/** The rows from a to b (inclusive) in the order shown; [b] if a isn't shown. */
export function rangeBetween(order, a, b) {
  const i = order.indexOf(a), j = order.indexOf(b);
  if (j < 0) return [];
  if (i < 0) return [b];
  return i <= j ? order.slice(i, j + 1) : order.slice(j, i + 1);
}

/**
 * The filter box: files whose path holds every word (any case), the ones
 * whose name matches first, then by path. `limit` keeps the list short.
 */
export function filterPaths(paths, query, limit = 200) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (!words.every((w) => lower.includes(w))) continue;
    const name = basename(lower);
    hits.push({ p, inName: words.every((w) => name.includes(w)) ? 0 : 1 });
  }
  hits.sort((a, b) => a.inName - b.inName || a.p.localeCompare(b.p));
  return hits.slice(0, limit).map((x) => x.p);
}

/** Trash entries older than TRASH_DAYS (to delete for good). */
export function expired(entries, now = Date.now(), days = TRASH_DAYS) {
  return entries.filter((e) => now - e.deletedAt > days * DAY);
}

/** Whole days left before the trash deletes an entry for good. */
export function daysLeft(deletedAt, now = Date.now(), days = TRASH_DAYS) {
  return Math.max(0, Math.ceil((deletedAt + days * DAY - now) / DAY));
}
