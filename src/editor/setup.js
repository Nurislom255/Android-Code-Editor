// editor/setup.js — the CodeMirror extension list for one document.
//
// "Compartments" are slots that can be reconfigured later without rebuilding
// the editor: the language arrives asynchronously (lazy-loaded), wrap and
// read-only are per-file toggles, indent settings come from .editorconfig.

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, indentUnit } from '@codemirror/language';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap, search } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, completeAnyWord } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { editorTheme, editorHighlighting } from './theme.js';
import { wrapIndent, stickyScroll, fastScroll } from './viewPlugins.js';
import { expandStack } from './selection.js';
import { syntaxLinter } from './syntaxLint.js';
import { gitGutter } from './gitGutter.js';
import { snippetSource } from './snippets.js';

export const comp = {
  language: new Compartment(),
  langData: new Compartment(),
  wrap: new Compartment(),
  readOnly: new Compartment(),
  indent: new Compartment(),
  lineNumbers: new Compartment(),
  closeBrackets: new Compartment(),
  lint: new Compartment(),
  sticky: new Compartment(),
  fastScroll: new Compartment(),
};

/** Languages whose own completion already offers identifiers from the file. */
const HAS_LOCAL_COMPLETION = new Set(['javascript', 'jsx', 'typescript', 'tsx', 'python', 'html', 'css']);

export function langDataExtension(languageId, userSnippets) {
  const sources = [];
  const snip = snippetSource(languageId, userSnippets);
  if (snip) sources.push(snip);
  if (!HAS_LOCAL_COMPLETION.has(languageId)) sources.push(completeAnyWord);
  return sources.length ? EditorState.languageData.of(() => sources.map((s) => ({ autocomplete: s }))) : [];
}

export function wrapExtension(on) { return on ? EditorView.lineWrapping : []; }
export function readOnlyExtension(locked) {
  // editable=false also stops the soft keyboard popping up while reading.
  return locked ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}
export function indentExtension({ insertSpaces, indentSize, tabWidth }) {
  return [indentUnit.of(insertSpaces ? ' '.repeat(indentSize) : '\t'), EditorState.tabSize.of(tabWidth)];
}
export function lineNumbersExtension(on) { return on ? [lineNumbers(), highlightActiveLineGutter()] : []; }
export function closeBracketsExtension(on) { return on ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []; }
export function lintExtension(on) { return on ? syntaxLinter() : []; }
export function stickyExtension(on) { return on ? stickyScroll : []; }
export function fastScrollExtension(on) { return on ? fastScroll : []; }

/**
 * @param {object} o
 * @param {object} o.doc       workspace document (wrap, locked, config, lang)
 * @param {object} o.settings  app settings
 * @param {object} o.userSnippets parsed user snippets
 * @param {any[]}  o.extra     workspace hooks (update listeners, keymaps)
 */
export function buildExtensions({ doc, settings, userSnippets, extra = [] }) {
  return [
    comp.lineNumbers.of(lineNumbersExtension(settings.lineNumbers)),
    gitGutter,
    foldGutter({ markerDOM: foldMarker }),
    highlightSpecialChars(),
    history({ newGroupDelay: 700 }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    editorHighlighting,
    bracketMatching(),
    comp.closeBrackets.of(closeBracketsExtension(settings.autoCloseBrackets)),
    autocompletion({ activateOnTyping: true, closeOnBlur: true, icons: true, maxRenderedOptions: 60 }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    expandStack,
    wrapIndent,
    comp.sticky.of(stickyExtension(settings.stickyScroll)),
    comp.fastScroll.of(fastScrollExtension(settings.fastScroll)),
    comp.language.of([]),
    comp.langData.of(langDataExtension(doc.lang.id, userSnippets)),
    comp.lint.of([]),
    comp.wrap.of(wrapExtension(doc.wrap)),
    comp.readOnly.of(readOnlyExtension(doc.locked || !!doc.readOnlyReason)),
    comp.indent.of(indentExtension(doc.indent)),
    EditorView.contentAttributes.of({
      // Keyboards shouldn't "fix" code: no autocorrect, no capitalisation,
      // no spellcheck squiggles (spec §3.1, the web equivalent of
      // TYPE_TEXT_FLAG_NO_SUGGESTIONS).
      autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', translate: 'no',
      'data-gramm': 'false', 'aria-label': `Code editor: ${doc.name}`,
    }),
    editorTheme,
    ...extra,
    keymap.of([
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
  ];
}

function foldMarker(open) {
  const el = document.createElement('span');
  el.className = 'cm-fold-marker' + (open ? ' open' : '');
  el.textContent = open ? '⌄' : '›';
  el.title = open ? 'Fold' : 'Unfold';
  return el;
}
