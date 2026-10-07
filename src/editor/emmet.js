// editor/emmet.js — Emmet abbreviations as autocomplete suggestions (HTML and
// CSS), expanded by accepting the suggestion: Tab, Enter or swipe right.
//
//   !                 → HTML5 boilerplate
//   div.card>ul>li*3  → nested tags, with tab stops
//   div  (new line)   → <div>|</div>        (tag names without typing "<")
//   m10 / df          → margin: 10px; / display: flex;   (CSS, inside { })
//
// The emmet package (MIT) is loaded on first use, so it costs nothing for
// files that never need it. The decision of *when* to offer an abbreviation
// lives in core/emmetRules.js.

import { syntaxTree } from '@codemirror/language';
import { snippet } from '@codemirror/autocomplete';
import {
  HTML_TAGS, fieldMarker, toSnippetTemplate, plainExpansion, simplifyBoilerplate,
  markupAbbreviationOk, stylesheetAbbreviationOk, insideCssBlock,
} from '../core/emmetRules.js';

let loading = null;
function loadEmmet() {
  if (!loading) {
    loading = import('emmet').then((m) => {
      const aliases = new Set(Object.keys(m.resolveConfig({ type: 'markup', syntax: 'html' }).snippets));
      return { expand: m.default, extract: m.extract, isKnown: (name) => HTML_TAGS.has(name) || aliases.has(name) };
    });
  }
  return loading;
}

const OPTIONS = { 'output.field': fieldMarker, 'output.indent': '\t', 'stylesheet.fuzzySearchMinScore': 0.5 };

/** Where in an HTML document the cursor is: 'markup', 'stylesheet' (in <style> / style="") or null. */
function htmlMode(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    switch (node.name) {
      case 'Block': return 'stylesheet';                 // CSS inside <style>
      case 'StyleSheet': case 'Script': return null;     // <style> outside a rule, <script>
      case 'OpenTag': case 'CloseTag': case 'SelfClosingTag': case 'Comment':
      case 'Attribute': case 'AttributeValue': case 'ProcessingInst': case 'Doctype':
        return null;
      default:
    }
  }
  return 'markup';
}

/**
 * @param {'html'|'css'} kind  which kind of file the source is for
 */
export function emmetSource(kind) {
  return async (context) => {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from);
    if (!before.trim() || /\s$/.test(before)) return null;
    let type;
    if (kind === 'css') {
      if (!insideCssBlock(state.sliceDoc(Math.max(0, pos - 20000), pos))) return null;
      type = 'stylesheet';
    } else {
      type = htmlMode(state, pos);
      if (!type) return null;
    }
    const em = await loadEmmet();
    if (context.aborted) return null;
    let found;
    try {
      found = em.extract(before, before.length, { type, lookAhead: false });
    } catch {
      return null;
    }
    if (!found || !found.abbreviation) return null;
    const abbr = found.abbreviation;
    const prefix = before.slice(0, found.start);
    if (type === 'markup' && !markupAbbreviationOk(abbr, prefix, em.isKnown, context.explicit)) return null;
    let out;
    try {
      out = em.expand(abbr, { type, options: OPTIONS });
    } catch {
      return null; // not a valid abbreviation (yet)
    }
    if (!out) return null;
    if (type === 'stylesheet' && !stylesheetAbbreviationOk(abbr, plainExpansion(out), prefix)) return null;
    const preview = plainExpansion(out);
    const lines = preview.split('\n');
    return {
      from: line.from + found.start,
      to: pos,
      filter: false,
      options: [{
        label: abbr,
        detail: abbr === '!' ? 'HTML5 page' : 'Emmet',
        type: 'emmet',
        boost: 10,
        info: lines.length > 14 ? lines.slice(0, 14).join('\n') + '\n…' : preview,
        apply: snippet(/^(?:!|html:5|doc)$/.test(abbr) ? simplifyBoilerplate(toSnippetTemplate(out)) : toSnippetTemplate(out)),
      }],
    };
  };
}
