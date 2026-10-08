// editor/completions.js — completion sources shared by every language:
//   • words from the OTHER open files (the current file is covered by the
//     language's own scope completion or completeAnyWord),
//   • project file paths inside src="…", href="…", url(…), import '…',
//     #include "…" and Markdown links,
// plus a fallback that opens the list while a soft keyboard is composing.

import { ViewPlugin } from '@codemirror/view';
import { completionStatus, startCompletion } from '@codemirror/autocomplete';
import { docInfo, editorEnv } from './context.js';
import { dirname, relative, extname } from '../core/paths.js';

// ---- words from other open files -------------------------------------------

const WORD_RE = /[A-Za-z_$][\w$]{2,}/g;
const MAX_WORDS = 4000;
const wordCache = new WeakMap(); // Text -> Set<string>

function wordsOf(text) {
  let words = wordCache.get(text);
  if (!words) {
    words = new Set();
    const str = text.length > 300000 ? text.sliceString(0, 300000) : text.toString();
    for (const m of str.matchAll(WORD_RE)) {
      words.add(m[0]);
      if (words.size >= MAX_WORDS) break;
    }
    wordCache.set(text, words);
  }
  return words;
}

// Words already in the current file come from the language's own completion;
// leaving them out avoids duplicates. Re-reading the whole current file on
// every keystroke would be wasteful, so its word list is refreshed at most
// every 2 s (a duplicate for a word typed since then is harmless).
const ownCache = new Map(); // doc id -> {time, words}
function ownWords(info, text) {
  if (!info) return wordsOf(text);
  const now = Date.now();
  const hit = ownCache.get(info.id);
  if (hit && now - hit.time < 2000) return hit.words;
  const words = wordsOf(text);
  ownCache.set(info.id, { time: now, words });
  if (ownCache.size > 50) ownCache.delete(ownCache.keys().next().value);
  return words;
}

export function openFilesWordSource(context) {
  const word = context.matchBefore(/[\w$]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const info = context.state.facet(docInfo);
  const others = editorEnv.openDocs().filter((d) => d.state && (!info || d.id !== info.id));
  if (!others.length) return null;
  const own = ownWords(info, context.state.doc);
  const seen = new Set();
  const options = [];
  for (const d of others) {
    for (const w of wordsOf(d.state.doc)) {
      if (seen.has(w) || own.has(w)) continue;
      seen.add(w);
      options.push({ label: w, type: 'text', detail: d.name, boost: -10 });
    }
  }
  return options.length ? { from: word.from, options, validFor: /^[\w$]*$/ } : null;
}

// ---- file paths ----------------------------------------------------------------

const HEADER_EXT = new Set(['.h', '.hh', '.hpp', '.hxx', '.inl', '.ipp', '.tpp', '.inc']);
const IMPORT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.json', '.css', '.wasm']);
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico', '.bmp', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.css', '.cur']);

const JS_LANGS = new Set(['javascript', 'jsx', 'typescript', 'tsx', 'html']);
const CSS_LANGS = new Set(['css', 'scss', 'less', 'html']);

/** Where a path is being typed, per language. `m[1]` is the path typed so far. */
const PATH_CONTEXTS = [
  { langs: new Set(['html', 'xml', 'markdown', 'php']), re: /\b(?:src|href|action|poster|data|srcset)\s*=\s*["']([^"']*)$/i, accept: () => true },
  { langs: CSS_LANGS, re: /@import\s+(?:url\(\s*)?["']([^"']*)$/, accept: (f) => extname(f) === '.css' || extname(f) === '.scss' || extname(f) === '.less' },
  { langs: null, re: /\burl\(\s*["']?([^"'()\s]*)$/, accept: (f) => ASSET_EXT.has(extname(f)) },
  {
    langs: JS_LANGS,
    re: /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bfetch\s*\(\s*|\bnew\s+URL\s*\(\s*|\bnew\s+Worker\s*\(\s*)["'`]([^"'`]*)$/,
    accept: (f, anyFile) => anyFile || IMPORT_EXT.has(extname(f)),
    dotSlash: true,
  },
  { langs: new Set(['c', 'cpp']), re: /^\s*#\s*include\s*"([^"]*)$/, accept: (f) => HEADER_EXT.has(extname(f)) },
  { langs: new Set(['markdown']), re: /\]\(([^)\s]*)$/, accept: () => true },
];

export async function pathSource(context) {
  const info = context.state.facet(docInfo);
  if (!info) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  for (const c of PATH_CONTEXTS) {
    if (c.langs && !c.langs.has(info.langId)) continue;
    const m = c.re.exec(before);
    if (!m) continue;
    const typed = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(typed)) return null; // external URL, anchor
    const docPath = editorEnv.docPath(info.id);
    const dir = docPath ? dirname(docPath) : '';
    const files = await editorEnv.projectFiles();
    if (context.aborted) return null;
    const absolute = typed.startsWith('/');
    // fetch()/new URL() can load any file; import/require only code.
    const anyFile = /fetch|URL|Worker/.test(m[0]);
    const options = [];
    for (const f of files) {
      if (f === docPath || !c.accept(f, anyFile)) continue;
      let label = absolute ? '/' + f : relative(dir, f);
      if (c.dotSlash && !absolute && !label.startsWith('.')) label = './' + label;
      // Nearer files first.
      options.push({ label, type: 'file', boost: -Math.min(20, label.split('/').length) });
      if (options.length >= 1000) break;
    }
    return options.length ? { from: context.pos - typed.length, options, validFor: /^[^"'`()\s]*$/ } : null;
  }
  return null;
}

// ---- suggestions while a soft keyboard is composing ------------------------------
//
// Gboard and other keyboards type words in "composition" mode. CodeMirror's
// own activation can be reset by the selection updates those keyboards send
// between letters, so the list may never open. When a composing edit leaves
// a word before the cursor and no list is open ~110 ms later, open it.

export const composeCompletion = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.timer = 0;
  }

  update(u) {
    if (!u.transactions.some((tr) => tr.isUserEvent('input.type.compose'))) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), 110);
  }

  check() {
    const v = this.view;
    if (!v.hasFocus || v.state.readOnly || completionStatus(v.state) !== null) return;
    const head = v.state.selection.main.head;
    const line = v.state.doc.lineAt(head);
    if (!/[\w$]$/.test(line.text.slice(Math.max(0, head - line.from - 1), head - line.from))) return;
    startCompletion(v);
  }

  destroy() {
    clearTimeout(this.timer);
  }
});
