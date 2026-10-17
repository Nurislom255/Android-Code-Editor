// core/pages.js — which web page loads a script. Run on a page's script
// (app.js in the Web template) shows that page: in the console sandbox there
// is no page, so `document` "is not defined".

import { dirname, resolveUrlRef } from './paths.js';

const SCRIPT_SRC = /<script\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi;

/** The project's scripts an HTML page loads (<script src>), as project paths. */
export function scriptsOf(htmlPath, html) {
  const out = [];
  const live = html.replace(/<!--[\s\S]*?-->/g, ''); // not the commented-out ones
  for (const m of live.matchAll(SCRIPT_SRC)) {
    const p = resolveUrlRef(dirname(htmlPath), m[2]);
    if (p) out.push(p);
  }
  return out;
}

/** HTML pages in the order to look for a script's page: the same folder first, then nearer ones. */
export function pagesNear(jsPath, paths) {
  const dir = dirname(jsPath);
  const score = (p) => {
    const d = dirname(p);
    const same = d === dir ? 0 : dir.startsWith(d ? d + '/' : '') ? 1 : 2; // same folder, a folder above, elsewhere
    return [same, /(^|\/)index\.html?$/i.test(p) ? 0 : 1, p.split('/').length, p];
  };
  return paths.filter((p) => /\.html?$/i.test(p)).map((p) => [score(p), p])
    .sort(([a], [b]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : 1)).map(([, p]) => p);
}

/** Names that only exist in a web page (so the console can say why they are missing). */
export const PAGE_ONLY = /\b(document|window|alert|localStorage|sessionStorage|navigator|location|HTMLElement)\b is not defined/;
