// core/search.js — text search used by project-wide search (spec §2 Phase 2).
// In-file find/replace uses CodeMirror's own search panel; this is for
// scanning many files, so it works on plain strings.

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @returns {RegExp} global matcher; throws a readable Error for a bad regex
 */
export function buildMatcher(query, { regex = false, caseSensitive = false, wholeWord = false } = {}) {
  if (!query) throw new Error('Type something to search for.');
  let source = regex ? query : escapeRegExp(query);
  if (wholeWord) source = `(?<![\\w$])(?:${source})(?![\\w$])`;
  try {
    return new RegExp(source, 'g' + (caseSensitive ? '' : 'i') + 'm');
  } catch (err) {
    throw new Error(`Invalid regular expression: ${err.message.replace(/^Invalid regular expression: /, '')}`);
  }
}

const PREVIEW_CONTEXT = 40;

/**
 * @returns {{line:number, col:number, length:number, preview:string, previewStart:number}[]}
 *          line/col are 1-based line and 0-based column
 */
export function findInText(text, matcher, maxResults = 500) {
  const results = [];
  matcher.lastIndex = 0;
  // Precompute line starts once; binary search per match.
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);

  let m;
  while ((m = matcher.exec(text)) && results.length < maxResults) {
    if (m[0].length === 0) { matcher.lastIndex++; continue; } // avoid infinite loops on /^/ etc.
    const line = lineAt(lineStarts, m.index);
    const lineStart = lineStarts[line];
    const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
    const col = m.index - lineStart;
    const from = Math.max(0, col - PREVIEW_CONTEXT);
    const lineText = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    const preview = (from > 0 ? '…' : '') + lineText.slice(from, col + m[0].length + PREVIEW_CONTEXT * 2);
    results.push({
      line: line + 1,
      col,
      length: Math.min(m[0].length, lineEnd - m.index),
      preview,
      previewStart: col - from + (from > 0 ? 1 : 0),
    });
  }
  return results;
}

function lineAt(starts, pos) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return lo;
}
