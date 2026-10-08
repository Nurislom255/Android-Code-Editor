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
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { snippet, completionStatus, selectedCompletion, closeCompletion } from '@codemirror/autocomplete';
import {
  HTML_TAGS, fieldMarker, toSnippetTemplate, plainExpansion, simplifyBoilerplate,
  markupAbbreviationOk, stylesheetAbbreviationOk, insideCssBlock, tagSuggestions,
} from '../core/emmetRules.js';

let loading = null;
function loadEmmet() {
  if (!loading) {
    loading = import('emmet').then((m) => {
      const aliases = new Set(Object.keys(m.resolveConfig({ type: 'markup', syntax: 'html' }).snippets));
      const templates = new Map();
      const tagTemplate = (tag) => {
        if (!templates.has(tag)) templates.set(tag, toSnippetTemplate(m.default(tag, { options: OPTIONS })));
        return templates.get(tag);
      };
      return { expand: m.default, extract: m.extract, tagTemplate, isKnown: (name) => HTML_TAGS.has(name) || aliases.has(name) };
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
    if (type === 'markup' && HTML_TAGS.has(abbr)) return null; // plain tag names: tagNameSource
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

/**
 * Tag names while typing plain HTML text: "di" → div, dialog…, accepted with
 * Tab / swipe right / Enter into `<div>|</div>`. Not inside attribute values,
 * comments, <script> or <style> (see htmlMode) or quoted text.
 */
export async function tagNameSource(context) {
  const word = context.matchBefore(/[A-Za-z][\w-]*/);
  if (!word) return null;
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const { tags, atTagStart } = tagSuggestions(word.text, state.sliceDoc(line.from, word.from), context.explicit);
  if (!tags.length || htmlMode(state, pos) !== 'markup') return null;
  const em = await loadEmmet();
  if (context.aborted) return null;
  return {
    from: word.from,
    to: pos,
    options: tags.map((tag, i) => ({
      label: tag,
      detail: `<${tag}>`,
      type: 'tag',
      boost: 60 - Math.min(i, 59),
      apply: snippet(em.tagTemplate(tag)),
      // In the middle of a sentence Enter keeps meaning "new line" (below).
      prose: !atTagStart,
    })),
  };
}

/**
 * Typing a sentence in HTML that ends in "time" or "table" and pressing Enter
 * should start a new line, not create <time></time>: for suggestions made
 * in the middle of text, Enter closes the list instead of accepting
 * (Tab and swipe right still accept).
 */
export const proseEnter = Prec.highest(keymap.of([{
  key: 'Enter',
  run: (view) => {
    if (completionStatus(view.state) !== 'active') return false;
    const c = selectedCompletion(view.state);
    if (c && c.prose) closeCompletion(view);
    return false;
  },
}]));
