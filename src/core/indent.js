// core/indent.js — guess a file's indentation from its content (like VS Code's
// "detect indentation"), used when no .editorconfig says otherwise. Opening a
// tab-indented Makefile or a 4-space Python file should keep that style
// instead of mixing in the global default.

export function detectIndent(text, maxLines = 3000) {
  let tabLines = 0, spaceLines = 0;
  const deltas = new Map(); // indent delta in spaces -> count
  let prev = 0;
  let n = 0;
  let start = 0;
  while (start <= text.length && n < maxLines) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    n++;
    if (!line.trim()) continue;
    if (line[0] === '\t') { tabLines++; continue; }
    const spaces = line.length - line.trimStart().length;
    if (spaces > 0 && line[spaces] !== '*') spaceLines++; // " * " inside block comments isn't indentation
    if (line[spaces] === '*') continue;
    const d = Math.abs(spaces - prev);
    if (d > 1) deltas.set(d, (deltas.get(d) || 0) + 1);
    prev = spaces;
  }
  if (tabLines === 0 && spaceLines === 0) return null;
  if (tabLines > spaceLines) return { insertSpaces: false, size: null };
  let best = null, bestCount = 0;
  for (const size of [2, 4, 8, 3]) {
    const c = deltas.get(size) || 0;
    if (c > bestCount * 1.5 || (best === null && c > 0)) { best = size; bestCount = c; }
  }
  return { insertSpaces: true, size: best || 4 };
}
