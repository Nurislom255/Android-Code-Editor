// core/fuzzy.js — fuzzy matching for Quick Open (Ctrl+P) and the command palette.
//
// Same idea as VS Code / fzf: the query letters must appear in order, but not
// necessarily next to each other. The score rewards matches that a human
// would call "obvious": consecutive letters, letters at the start of a word
// (after / . _ - or a camelCase hump), and matches in the file name rather
// than the folder path.

const SEPARATORS = new Set(['/', '\\', '.', '_', '-', ' ', ':']);

function isWordStart(text, i) {
  if (i === 0) return true;
  const prev = text[i - 1];
  if (SEPARATORS.has(prev)) return true;
  const c = text[i];
  return prev === prev.toLowerCase() && c !== c.toLowerCase(); // camelCase hump
}

/**
 * @returns {{score:number, positions:number[]} | null}  null when not a match
 */
export function fuzzyMatch(query, text) {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (q.length > t.length) return null;

  // Greedy forward scan proves it's a match at all (cheap reject).
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++;
  if (qi < q.length) return null;

  // Then a small DP picks the best-scoring alignment.
  const n = t.length, m = q.length;
  const NEG = -1e9;
  // best[j][i]: best score with q[0..j] matched and q[j] at t[i]
  let prev = new Float64Array(n).fill(NEG);
  const from = [];
  const nameStart = text.lastIndexOf('/') + 1;
  for (let j = 0; j < m; j++) {
    const cur = new Float64Array(n).fill(NEG);
    const back = new Int32Array(n).fill(-1);
    let bestPrev = NEG, bestPrevIdx = -1;
    for (let i = 0; i < n; i++) {
      if (j > 0 && i > 0 && prev[i - 1] > bestPrev) { bestPrev = prev[i - 1]; bestPrevIdx = i - 1; }
      if (t[i] !== q[j]) continue;
      let s = 1;
      if (isWordStart(text, i)) s += 8;
      if (i >= nameStart) s += 2;
      if (text[i] === query.replace(/\s+/g, '')[j]) s += 0.5; // exact case
      if (j === 0) {
        cur[i] = s - i * 0.05; // earlier first match is slightly better
      } else {
        const consecutive = i > 0 && prev[i - 1] > NEG ? prev[i - 1] + s + 6 : NEG;
        const gap = bestPrev > NEG ? bestPrev + s - 1 : NEG;
        if (consecutive >= gap && consecutive > NEG) { cur[i] = consecutive; back[i] = i - 1; }
        else if (gap > NEG) { cur[i] = gap; back[i] = bestPrevIdx; }
      }
    }
    from.push(back);
    prev = cur;
  }
  let end = -1, best = NEG;
  for (let i = 0; i < n; i++) if (prev[i] > best) { best = prev[i]; end = i; }
  if (end < 0) return null;
  const positions = [end];
  for (let j = m - 1; j > 0; j--) positions.unshift(from[j][positions[0]]);
  // Shorter targets win ties ("app.js" over "app.config.js").
  return { score: best - n * 0.01, positions };
}

/** Filters and sorts `items` by fuzzy score of `key(item)`. */
export function fuzzyFilter(query, items, key = (x) => x, limit = 200) {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }));
  const out = [];
  for (const item of items) {
    const m = fuzzyMatch(query, key(item));
    if (m) out.push({ item, ...m });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
