// editor/theme.js — editor look, driven by CSS variables.
//
// Instead of two CodeMirror themes (dark/light) that must be swapped with a
// reconfigure on every open document, the editor uses ONE theme whose colours
// are CSS custom properties, plus a highlighter that only assigns class names
// (tok-keyword, tok-string…). Switching theme is then just changing a class on
// <html> — no editor work at all. styles.css holds the actual colours.

import { EditorView } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { tagHighlighter, tags as t } from '@lezer/highlight';

const highlighter = tagHighlighter([
  { tag: t.comment, class: 'tok-comment' },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], class: 'tok-keyword' },
  { tag: [t.string, t.special(t.string), t.attributeValue, t.character], class: 'tok-string' },
  { tag: [t.regexp, t.escape], class: 'tok-regexp' },
  { tag: [t.number, t.integer, t.float], class: 'tok-number' },
  { tag: [t.bool, t.null, t.atom, t.self, t.unit], class: 'tok-atom' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)), t.macroName], class: 'tok-function' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], class: 'tok-definition' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], class: 'tok-type' },
  { tag: [t.tagName, t.angleBracket], class: 'tok-tag' },
  { tag: t.attributeName, class: 'tok-attribute' },
  { tag: [t.propertyName], class: 'tok-property' },
  { tag: [t.variableName, t.labelName], class: 'tok-variable' },
  { tag: [t.operator, t.derefOperator, t.compareOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.updateOperator], class: 'tok-operator' },
  { tag: [t.punctuation, t.separator, t.bracket, t.paren, t.squareBracket, t.brace], class: 'tok-punctuation' },
  { tag: [t.meta, t.documentMeta, t.annotation, t.processingInstruction], class: 'tok-meta' },
  { tag: t.heading, class: 'tok-heading' },
  { tag: t.emphasis, class: 'tok-emphasis' },
  { tag: t.strong, class: 'tok-strong' },
  { tag: t.strikethrough, class: 'tok-strike' },
  { tag: [t.link, t.url], class: 'tok-link' },
  { tag: t.quote, class: 'tok-quote' },
  { tag: [t.monospace], class: 'tok-code' },
  { tag: t.inserted, class: 'tok-inserted' },
  { tag: t.deleted, class: 'tok-deleted' },
  { tag: t.changed, class: 'tok-changed' },
  { tag: t.invalid, class: 'tok-invalid' },
]);

export const editorHighlighting = syntaxHighlighting(highlighter);

export const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--ed-fg)',
    backgroundColor: 'var(--ed-bg)',
    fontSize: 'var(--ed-font-size, 14px)',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.55',
    overscrollBehavior: 'contain',
  },
  '.cm-content': { caretColor: 'var(--ed-caret)', paddingBottom: '40vh' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ed-caret)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--ed-selection) !important' },
  '.cm-activeLine': { backgroundColor: 'var(--ed-active-line)' },
  '.cm-gutters': { backgroundColor: 'var(--ed-gutter-bg)', color: 'var(--ed-gutter-fg)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--ed-active-line)', color: 'var(--ed-fg)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 10px', minWidth: '28px' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--accent-dim)', border: 'none', color: 'var(--accent)', padding: '0 6px' },
  '.cm-selectionMatch': { backgroundColor: 'var(--ed-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--ed-search)', outline: '1px solid var(--ed-search-outline)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--ed-search-selected)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--ed-bracket)', outline: '1px solid var(--ed-bracket-outline)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--error-dim)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-panel-alt)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '14em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '6px 10px !important', lineHeight: '1.3' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-dim)', color: 'var(--text)' },
  '.cm-completionIcon-emmet::after': { content: "'⚡'" },
  '.cm-completionIcon-tag::after': { content: "'<>'", fontSize: '11px' },
  '.cm-completionIcon-file::after': { content: "'📄'" },
  '.cm-completionInfo': { whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '12px', maxWidth: 'min(420px, 70vw)' },
  '.cm-pending-semi': { opacity: '0.4' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent)', fontWeight: '600' },
  '.cm-completionDetail': { color: 'var(--text-faint)', fontStyle: 'normal', marginLeft: '1em' },
  '.cm-panels': { backgroundColor: 'var(--bg-panel)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel input, .cm-panel button': { fontSize: '14px' },
  '.cm-textfield': { backgroundColor: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 8px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--bg-panel-alt)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px' },
  '.cm-lintRange-error': { backgroundImage: 'var(--squiggle-error)' },
  '.cm-lintRange-warning': { backgroundImage: 'var(--squiggle-warning)' },
  '.cm-diagnostic': { fontFamily: 'var(--font-ui)' },
  '.cm-snippetField': { backgroundColor: 'var(--accent-dim)' },
  '.cm-snippetFieldPosition': { borderLeft: '2px solid var(--accent)' },
});
