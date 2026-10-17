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

// ---- custom order (drag to reorder in the file tree) ------------------------------
//
// A folder's custom order is the list of its entry names as the owner
// arranged them. Folders always stay above files; within each group the
// saved order wins, and names it doesn't know yet (new files) follow, A–Z.

const isDir = (e) => e.kind === 'directory';

/** A folder's entries in the order shown. `entries` come A–Z, folders first (as storage lists them). */
export function orderEntries(entries, saved) {
  if (!saved || !saved.length) return entries;
  const rank = new Map(saved.map((n, i) => [n, i]));
  const at = new Map(entries.map((e, i) => [e, i]));
  const r = (e) => (rank.has(e.name) ? rank.get(e.name) : Infinity);
  return [...entries].sort((a, b) => (isDir(b) - isDir(a)) || (r(a) - r(b)) || (at.get(a) - at.get(b)));
}

/**
 * The new saved order of a folder after putting `names` before `before`
 * (a name in the folder, or null = the end). A folder can't go among the
 * files, nor a file among the folders: they go to the end of their own
 * group, or its start, whichever is nearer to where they were dropped.
 */
export function reorderNames(entries, saved, names, before) {
  const shown = orderEntries(entries, saved);
  const kind = new Map(entries.map((e) => [e.name, isDir(e)]));
  const moving = names.filter((n) => kind.has(n));
  const all = shown.map((e) => e.name);
  // "Before itself": before the next entry that stays.
  if (before != null && moving.includes(before)) before = all.slice(all.indexOf(before)).find((n) => !moving.includes(n)) ?? null;
  const rest = all.filter((n) => !moving.includes(n));
  const dirs = rest.filter((n) => kind.get(n));
  const files = rest.filter((n) => !kind.get(n));
  const insert = (group, isFolder) => {
    const mine = moving.filter((n) => kind.get(n) === isFolder);
    if (!mine.length) return group;
    let i = before == null ? group.length : group.indexOf(before);
    if (i < 0) i = before != null && kind.get(before) && !isFolder ? 0 : group.length; // dropped in the other group
    return [...group.slice(0, i), ...mine, ...group.slice(i)];
  };
  return [...insert(dirs, true), ...insert(files, false)];
}

/**
 * The saved orders after `from` was renamed or moved to `to`: a rename keeps
 * its place; a moved entry leaves its old folder's list; the orders of the
 * folders inside a moved folder move with it. `orders` maps folder → names.
 */
export function relocateOrder(orders, from, to) {
  const out = {};
  for (const [dir, names] of Object.entries(orders || {})) {
    const key = dir === from || dir.startsWith(from + '/') ? to + dir.slice(from.length) : dir;
    out[key] = names;
  }
  const parent = dirname(from);
  if (out[parent]) {
    out[parent] = dirname(to) === parent
      ? out[parent].map((n) => (n === basename(from) ? basename(to) : n))
      : out[parent].filter((n) => n !== basename(from));
  }
  return out;
}
