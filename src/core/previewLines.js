// core/previewLines.js — maps line numbers in the generated preview page back
// to the project files its scripts came from.
//
// The preview runs one self-contained page (scripts inlined). Browsers report
// a syntax error there as "about:srcdoc:64": line 64 of that generated page,
// which means nothing to the user. While the page is built, every inlined
// <script> is tagged with the file it came from and the line its code starts
// on in that file; scriptLineMap reads the tags back out of the final HTML.

const TAG = /<script\b[^>]*>/gi;
const ATTRS = /\sdata-ce-(?:src|line)="[^"]*"/g;

/**
 * @param {string} html  the page with tagged scripts (data-ce-src = encoded path, data-ce-line)
 * @returns {{html: string, map: {from:number, to:number, path:string, line:number}[]}}
 *          the page without the tags, and for each script the page lines it
 *          spans (from..to) and the file line of its first line
 */
export function scriptLineMap(html) {
  const map = [];
  let line = 1, at = 0;
  const lineAt = (i) => { for (; at < i; at++) if (html.charCodeAt(at) === 10) line++; return line; };
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(html))) {
    const src = /\sdata-ce-src="([^"]*)"/.exec(m[0]);
    if (!src) continue;
    const start = /\sdata-ce-line="(\d+)"/.exec(m[0]);
    const codeAt = m.index + m[0].length;
    const close = html.indexOf('</script', codeAt);
    const from = lineAt(codeAt);
    const to = close < 0 ? from : lineAt(close);
    map.push({ from, to, path: decodeURIComponent(src[1]), line: start ? Number(start[1]) : 1 });
    if (close > TAG.lastIndex) TAG.lastIndex = close;
  }
  return { html: html.replace(TAG, (tag) => tag.replace(ATTRS, '')), map };
}

/** "SyntaxError: … (about:srcdoc:64:3)" → "SyntaxError: … (app.js:9:3)". */
export function mapPageRefs(text, map) {
  if (!map || !map.length) return text;
  return text.replace(/about:srcdoc:(\d+)(?::(\d+))?/g, (all, l, c) => {
    const n = Number(l);
    const s = map.find((e) => n >= e.from && n <= e.to);
    if (!s) return all;
    // The first line shares its row with the <script> tag: its column is off.
    return `${s.path}:${s.line + n - s.from}${c && n > s.from ? `:${c}` : ''}`;
  });
}

/**
 * Where a syntax error is. Browsers give its line in the generated page, as
 * "about:srcdoc" (Firefox) or under the script's sourceURL name (Chrome).
 * @param {{file:string, line:number, col:number}} at  from the error event
 */
export function locateInPage(at, map) {
  const s = (map || []).find((e) => at.line >= e.from && at.line <= e.to && (at.file === e.path || /^about:/.test(at.file)));
  if (s) return `${s.path}:${s.line + at.line - s.from}${at.col && at.line > s.from ? `:${at.col}` : ''}`;
  if (at.file && !/^about:/.test(at.file)) return `${at.file}:${at.line}${at.col ? `:${at.col}` : ''}`;
  return `line ${at.line} of the page`;
}

/** Line (1-based) where `code` starts inside `source`, searching from `from`; 0 if not found. */
export function lineOfText(source, code, from = 0) {
  if (!code) return { line: 0, end: from };
  const i = source.indexOf(code, from);
  if (i < 0) return { line: 0, end: from };
  let line = 1;
  for (let k = 0; k < i; k++) if (source.charCodeAt(k) === 10) line++;
  return { line, end: i + code.length };
}
