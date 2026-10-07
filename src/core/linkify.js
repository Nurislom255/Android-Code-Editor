// core/linkify.js — finds "file:line:col" references in console output so
// they can be rendered as tappable links (spec §2 Phase 3: clickable errors).
//
// Matches things like:
//   at greet (src/app.js:12:5)      app.js:3      ./lib/util.mjs:40:1
// but not URLs ("http://host:8080") — those have "://" in front.

const REF = /(^|[\s(@"'[])((?:\.{0,2}\/)?(?:[\w.$@+-]+\/)*[\w.$@+-]+\.[A-Za-z][\w]{0,7}):(\d+)(?::(\d+))?/g;

/**
 * @param {string} text
 * @param {(path:string)=>string|null} resolve  maps a matched path to a project
 *        path, or null when it isn't a file we know (then no link is made)
 * @returns {({text:string}|{text:string, path:string, line:number, col:number})[]}
 */
export function linkify(text, resolve = (p) => p) {
  const parts = [];
  let last = 0;
  REF.lastIndex = 0;
  let m;
  while ((m = REF.exec(text))) {
    const start = m.index + m[1].length;
    const before = text.slice(Math.max(0, start - 3), start);
    if (before.endsWith('://') || /[\w]:\/\/[^\s]*$/.test(text.slice(0, start))) continue;
    const path = resolve(m[2].replace(/^\.\//, ''));
    if (!path) continue;
    if (start > last) parts.push({ text: text.slice(last, start) });
    const end = m.index + m[0].length;
    parts.push({ text: text.slice(start, end), path, line: Number(m[3]), col: m[4] ? Number(m[4]) : 1 });
    last = end;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
