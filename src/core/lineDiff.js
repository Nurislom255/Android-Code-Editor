// core/lineDiff.js — line diff (Myers' O(ND) algorithm).
//
// Used for: git gutter markers (HEAD vs. buffer), the git diff view, and
// comparing local-history snapshots. The same algorithm `git diff` uses by
// default.
//
// Myers in one paragraph: picture a grid with the old lines on one axis and
// the new lines on the other. Moving right = delete a line, moving down =
// insert a line, moving diagonally = the lines are equal (free). The shortest
// edit script is the path from top-left to bottom-right with the fewest
// non-diagonal moves. Myers explores paths by increasing number of edits D,
// keeping, for every diagonal k, how far along it the best path reaches.

const MAX_EDIT_DISTANCE = 4000;

/** Splits text into lines; a trailing "\n" does not create an extra empty line. */
export function splitLines(text) {
  if (text === '') return [];
  const lines = text.split(/\r\n?|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * @param {string[]} a old lines
 * @param {string[]} b new lines
 * @returns {{oldStart:number, oldLines:number, newStart:number, newLines:number}[]}
 *          0-based hunks of changed lines (equal runs are omitted)
 */
export function diffLines(a, b) {
  // Strip the common prefix/suffix first: most edits touch a few lines in the
  // middle of a file, so this makes the real diff tiny.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  if (A.length === 0 && B.length === 0) return [];

  // Map lines to integers so the inner loop compares numbers, not strings.
  const ids = new Map();
  const toId = (s) => { let v = ids.get(s); if (v === undefined) { v = ids.size; ids.set(s, v); } return v; };
  const ai = Int32Array.from(A, toId);
  const bi = Int32Array.from(B, toId);

  const ops = myers(ai, bi); // array of 'e' | 'd' | 'i' over A/B
  const hunks = [];
  let x = 0, y = 0, cur = null;
  for (const op of ops) {
    if (op === 'e') {
      if (cur) { hunks.push(cur); cur = null; }
      x++; y++;
    } else {
      if (!cur) cur = { oldStart: x + pre, oldLines: 0, newStart: y + pre, newLines: 0 };
      if (op === 'd') { cur.oldLines++; x++; } else { cur.newLines++; y++; }
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

function myers(a, b) {
  const n = a.length, m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const limit = Math.min(max, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2)); // only the diagonals reachable at this d
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1]; // down (insert)
      else x = v[offset + k - 1] + 1; // right (delete)
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, d);
    }
  }
  // Too different to be worth a precise diff: one big replacement.
  return [...Array(n).fill('d'), ...Array(m).fill('i')];
}

function backtrack(trace, n, m, dEnd) {
  const ops = [];
  let x = n, y = m;
  for (let d = dEnd; d > 0; d--) {
    const vs = trace[d]; // snapshot taken *before* step d, covering k in [-d-1, d+1]
    const get = (k) => vs[k + d + 1];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && get(k - 1) < get(k + 1))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push('e'); x--; y--; }
    ops.push(x === prevX ? 'i' : 'd');
    x = prevX; y = prevY;
  }
  while (x > 0 && y > 0) { ops.push('e'); x--; y--; }
  return ops.reverse();
}

/**
 * Gutter markers for the NEW text, VS Code style:
 * added lines, modified lines, and a "deleted" marker on the line *after*
 * which lines were removed.
 * @returns {{line:number, kind:'added'|'modified'|'deleted'}[]} 0-based lines
 */
export function gutterMarkers(oldText, newText) {
  const hunks = diffLines(splitLines(oldText), splitLines(newText));
  const markers = [];
  for (const h of hunks) {
    if (h.oldLines === 0) {
      for (let i = 0; i < h.newLines; i++) markers.push({ line: h.newStart + i, kind: 'added' });
    } else if (h.newLines === 0) {
      markers.push({ line: Math.max(0, h.newStart - 1), kind: 'deleted' });
    } else {
      for (let i = 0; i < h.newLines; i++) markers.push({ line: h.newStart + i, kind: 'modified' });
    }
  }
  return markers;
}

/**
 * Unified-diff style rows for display.
 * @returns {{kind:'context'|'add'|'del'|'hunk', text:string, oldNo?:number, newNo?:number}[]}
 */
export function unifiedRows(oldText, newText, context = 3) {
  const a = splitLines(oldText), b = splitLines(newText);
  const hunks = diffLines(a, b);
  const rows = [];
  // Merge hunks whose context overlaps.
  const groups = [];
  for (const h of hunks) {
    const last = groups[groups.length - 1];
    if (last && h.oldStart - (last.at(-1).oldStart + last.at(-1).oldLines) <= context * 2) last.push(h);
    else groups.push([h]);
  }
  for (const group of groups) {
    const first = group[0], lastH = group[group.length - 1];
    const oStart = Math.max(0, first.oldStart - context);
    const oEnd = Math.min(a.length, lastH.oldStart + lastH.oldLines + context);
    const nStart = Math.max(0, first.newStart - context);
    rows.push({ kind: 'hunk', text: `@@ -${oStart + 1},${oEnd - oStart} +${nStart + 1},${oEnd - oStart + (sumNew(group) - sumOld(group))} @@` });
    let o = oStart, nn = nStart;
    for (const h of group) {
      while (o < h.oldStart) rows.push({ kind: 'context', text: a[o], oldNo: ++o, newNo: ++nn });
      for (let i = 0; i < h.oldLines; i++) rows.push({ kind: 'del', text: a[o], oldNo: ++o });
      for (let i = 0; i < h.newLines; i++) rows.push({ kind: 'add', text: b[nn], newNo: ++nn });
    }
    while (o < oEnd) rows.push({ kind: 'context', text: a[o], oldNo: ++o, newNo: ++nn });
  }
  return rows;
}

const sumNew = (g) => g.reduce((s, h) => s + h.newLines, 0);
const sumOld = (g) => g.reduce((s, h) => s + h.oldLines, 0);

/** Applies hunks to `a` — used by tests to prove the diff is correct. */
export function applyHunks(a, b, hunks) {
  const out = [];
  let o = 0;
  for (const h of hunks) {
    while (o < h.oldStart) out.push(a[o++]);
    o += h.oldLines;
    for (let i = 0; i < h.newLines; i++) out.push(b[h.newStart + i]);
  }
  while (o < a.length) out.push(a[o++]);
  return out;
}
