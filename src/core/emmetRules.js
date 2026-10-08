// core/emmetRules.js — when an Emmet abbreviation should be offered, and how
// Emmet's output becomes a CodeMirror snippet. Pure, so it is unit-tested in
// Node; editor/emmet.js wires it to the editor and loads the emmet package.
//
// WHY RULES AT ALL: Emmet expands almost any word ("hello" → <hello></hello>,
// "foo" in CSS → "font: optional;"). Offering that for every word of HTML
// text would put a suggestion under the finger all the time, and Enter
// accepts a suggestion. So a suggestion appears only when the text is very
// likely meant as an abbreviation.

export const HTML_TAGS = new Set((
  'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col ' +
  'colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 ' +
  'h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta ' +
  'meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script search ' +
  'section select slot small source span strong style sub summary sup svg table tbody td template textarea tfoot th ' +
  'thead time title tr track u ul var video wbr'
).split(' '));

// Most-used tags first when several start with what was typed ("d" → div).
const POPULAR = [
  'div', 'p', 'span', 'a', 'img', 'ul', 'li', 'h1', 'h2', 'h3', 'button', 'input', 'section', 'header', 'footer',
  'nav', 'main', 'form', 'label', 'table', 'tr', 'td', 'th', 'ol', 'strong', 'em', 'br', 'hr', 'script', 'link',
  'meta', 'style', 'title', 'select', 'option', 'textarea', 'article', 'aside', 'figure', 'video', 'audio',
  'canvas', 'iframe', 'pre', 'code', 'small', 'details', 'summary', 'dialog',
];

/**
 * Tag names to suggest for a word typed in HTML text — "di" → div, dialog —
 * so a tag can be written without typing "<". Each one expands to
 * `<tag>|</tag>` (or `<img src="" alt="">` …).
 *   word    the word before the cursor
 *   prefix  the line before that word
 * Not for capitalised words or words glued to other characters ("ul>li" is
 * Emmet's job, `"di` is inside quotes); in the middle of a sentence only
 * from two letters on, so prose isn't interrupted at every word.
 * @returns {{tags:string[], atTagStart:boolean}}
 */
export function tagSuggestions(word, prefix, explicit = false) {
  const none = { tags: [], atTagStart: false };
  if (!/^[a-z][a-z0-9-]*$/.test(word)) return none;
  if (prefix && !/\s$/.test(prefix) && !/<[^<>]*>$/.test(prefix)) return none;
  const atTagStart = /^\s*$/.test(prefix) || /<[^<>]*>\s*$/.test(prefix);
  if (word.length < 2 && !atTagStart && !explicit) return none;
  const rank = (t) => (t === word ? -1 : POPULAR.includes(t) ? POPULAR.indexOf(t) : 100 + t.length);
  const tags = [...HTML_TAGS].filter((t) => t.startsWith(word)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { tags, atTagStart };
}

// Markers Emmet writes for tab stops (see `fieldMarker`), turned into
// CodeMirror's ${n:placeholder} syntax by `toSnippetTemplate`.
const F_OPEN = '\u0001', F_SEP = '\u0002', F_CLOSE = '\u0003';

/** Emmet's `output.field` option. */
export const fieldMarker = (index, placeholder) => `${F_OPEN}${index}${F_SEP}${placeholder || ''}${F_CLOSE}`;

/**
 * Emmet output (with field markers) → CodeMirror snippet template. Literal
 * braces are escaped so code like `p{a {b}}` or `${x}` in text can't be
 * mistaken for a field.
 */
export function toSnippetTemplate(out) {
  const escaped = out.replace(/[{}]/g, (c) => '\\' + c);
  return escaped.replace(/\u0001(\d+)\u0002([^\u0003]*)\u0003/g, (_, i, p) => {
    const placeholder = p.replace(/\\?[{}]/g, '');
    return placeholder ? `\${${i}:${placeholder}}` : `\${${i}}`;
  });
}

/**
 * The HTML page ("!") stops first in the viewport meta's values; the title
 * and the body are what you want to fill in, so those are the only stops kept.
 */
export function simplifyBoilerplate(template) {
  return template.replace(/\$\{\d+:(device-width|1\.0)\}/g, '$1');
}

/** Emmet output with the field markers removed (for the preview). */
export function plainExpansion(out) {
  return out.replace(/\u0001\d+\u0002([^\u0003]*)\u0003/g, '$1');
}

const OPERATOR = /[>+^*.#[{(]/;

/**
 * @param {string} abbr        the abbreviation Emmet extracted before the cursor
 * @param {string} linePrefix  the line text before the abbreviation
 * @param {(name:string)=>boolean} isKnown  HTML tag or Emmet alias (e.g. "btn", "link:css")
 * @param {boolean} explicit   the user asked for suggestions (swipe right, Ctrl+Space)
 */
export function markupAbbreviationOk(abbr, linePrefix, isKnown, explicit = false) {
  if (!abbr) return false;
  const atTagStart = /^\s*$/.test(linePrefix) || />\s*$/.test(linePrefix);
  if (abbr === '!') return atTagStart;
  if (/[>+^(]$/.test(abbr)) return false; // still typing an operator
  const stripped = abbr.replace(/\{[^{}]*\}/g, '').replace(/\[[^\]]*\]/g, '').replace(/\*\d*/g, '').replace(/@-?\d*/g, '');
  if (/[{}[\]]/.test(stripped)) return false; // unbalanced text or attribute block
  const parts = stripped.split(/[>+^()]/).filter(Boolean);
  if (!parts.length) return false;
  for (const part of parts) {
    const m = /^([a-z][\w:-]*|!!!)?((?:[.#][\w$-]+)*)$/.exec(part);
    if (!m) return false;
    const [, name, rest] = m;
    if (!name && !rest) return false;
    if (name && !isKnown(name)) return false;
  }
  if (OPERATOR.test(abbr)) return true;
  // A bare word ("div", "time", "p") is an abbreviation only where a tag
  // would start: at the start of a line or right after another tag — not in
  // the middle of a sentence. One-letter tags only when asked for.
  if (!atTagStart) return false;
  return abbr.length > 1 || explicit;
}

/**
 * CSS: Emmet's output must name a real property that differs from what was
 * typed ("m10" → "margin: 10px;" yes; "zi10" → "zi: 10px;" and "color" →
 * "color: ;" no — the CSS completion already offers those).
 */
export function stylesheetAbbreviationOk(abbr, expansion, linePrefix) {
  if (!abbr || !/^-?[a-z][a-z0-9.%!-]*$/i.test(abbr)) return false;
  if (!/^\s*$/.test(linePrefix) && !/[{;]\s*$/.test(linePrefix)) return false;
  const m = /^([a-z-]+)\s*:/.exec(expansion);
  if (!m) return false;
  const letters = abbr.replace(/^-/, '').match(/^[a-z-]*/i)[0].replace(/-$/, '');
  return m[1] !== letters;
}

/** Is `pos` inside a { } block of CSS text (ignoring comments and strings)? */
export function insideCssBlock(text) {
  let depth = 0;
  const re = /\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|[{}]/g;
  for (const m of text.matchAll(re)) {
    if (m[0] === '{') depth++;
    else if (m[0] === '}') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}
