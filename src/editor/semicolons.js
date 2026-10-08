// editor/semicolons.js — automatic semicolons and "Complete statement".
// The rules (which lines get a `;`) are in core/semicolons.js; this is the
// editing behaviour around them, kept cheap:
//
//   • Only when a trigger character (space, `=`, `(`, `<`, `>`, `+`, `-`) is
//     typed at the end of a line is the line looked at — one regex on the
//     line; only if that matches, a short look at the code above (is this a
//     function body?). Nothing else runs while typing.
//   • The `;` goes at the end of the line, faded, with the cursor before it.
//     It is a tab stop: Tab, swipe right or the keys-bar Tab jump past it
//     (like the end of a snippet); typing `;` steps over it; Enter steps over
//     it unless the line ends with something that continues (`=`, `,`, `<<`…).
//   • Backspace right after it appears removes it, and that line gets no
//     other one. Once the cursor leaves the line it's an ordinary `;`.
//   • A chain continued on the next line (`.then(…)`, `<< x`) takes back the
//     `;` that Enter just stepped over.
//
// Android keyboards type words in "composition" mode; changing text next to
// a word being composed can confuse them, so nothing is added during a
// composition — a small plugin catches up when it ends.

import { EditorView, Decoration, ViewPlugin, keymap } from '@codemirror/view';
import { EditorState, StateField, StateEffect, Prec } from '@codemirror/state';
import { insertNewlineAndIndent } from '@codemirror/commands';
import { completionStatus, hasNextSnippetField } from '@codemirror/autocomplete';
import { docInfo } from './context.js';
import {
  SEMICOLON_LANGS, TRIGGERS, isJsLike, autoSemicolon, scopeAt, enterStepsOver, isBareJump, codePart, completionPlan, prefersNoSemicolons,
} from '../core/semicolons.js';

const setPending = StateEffect.define();   // {pos, fresh} | null
const dismissLine = StateEffect.define();  // a position on the line
const setStepped = StateEffect.define();   // pos of a `;` Enter stepped over

/**
 * {pos, fresh, dismissed, stepped, noSemi}
 *   pos       the pending `;` (null if none)
 *   fresh     it was added by the previous edit (for Backspace)
 *   dismissed a position on a line where Backspace removed it
 *   stepped   the `;` Enter stepped over (for chain continuation)
 *   noSemi    the file is JS written without semicolons
 */
const semiField = StateField.define({
  create: (state) => ({ pos: null, fresh: false, dismissed: null, stepped: null, noSemi: detectNoSemi(state) }),
  update(v, tr) {
    let { pos, dismissed, stepped, noSemi } = v;
    // Only an edit or a cursor move ends "freshness" — not the effect-only
    // transactions the suggestion list dispatches.
    let fresh = tr.docChanged || tr.selection ? false : v.fresh;
    if (tr.docChanged) {
      if (pos != null) pos = tr.changes.mapPos(pos, 1);
      if (dismissed != null) dismissed = tr.changes.mapPos(dismissed, -1);
      if (stepped != null) stepped = tr.changes.mapPos(stepped, 1);
      let inserted = 0;
      tr.changes.iterChanges((_a, _b, _c, _d, text) => { inserted += text.length; });
      if (inserted > 200) noSemi = detectNoSemi(tr.state);
    }
    for (const e of tr.effects) {
      if (e.is(setPending)) { pos = e.value ? e.value.pos : null; fresh = !!(e.value && e.value.fresh); }
      else if (e.is(dismissLine)) dismissed = e.value;
      else if (e.is(setStepped)) stepped = e.value;
    }
    if (pos == null && dismissed == null && stepped == null && v.pos == null && v.dismissed == null && v.stepped == null && noSemi === v.noSemi) return v;
    const { doc, selection } = tr.state;
    const head = selection.main.head;
    const headLine = doc.lineAt(head).number;
    const isSemi = (p) => p != null && p < doc.length && doc.sliceString(p, p + 1) === ';';
    if (pos != null && (!isSemi(pos) || pos < head || doc.lineAt(pos).number !== headLine)) pos = null;
    if (dismissed != null && doc.lineAt(Math.min(dismissed, doc.length)).number !== headLine) dismissed = null;
    if (stepped != null) {
      // valid on its own line (Enter is about to open the next one) and on
      // the next line until that line has real content
      const line = isSemi(stepped) ? doc.lineAt(stepped).number : -1;
      if (line !== headLine && (line !== headLine - 1 || doc.lineAt(head).text.trim().length > 3)) stepped = null;
    }
    if (pos === v.pos && fresh === v.fresh && dismissed === v.dismissed && stepped === v.stepped && noSemi === v.noSemi) return v;
    return { pos, fresh, dismissed, stepped, noSemi };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => (v.pos == null ? Decoration.none : Decoration.set([pendingMark.range(v.pos, v.pos + 1)]))),
});

const pendingMark = Decoration.mark({ class: 'cm-pending-semi' });

function detectNoSemi(state) {
  const info = state.facet(docInfo);
  return !!info && isJsLike(info.langId) && prefersNoSemicolons(state.sliceDoc(0, Math.min(state.doc.length, 200000)));
}

const langOf = (state) => (state.facet(docInfo) || {}).langId;

const SCOPE_WINDOW = 4000; // chars above the line that scopeAt reads

/** 'body' | 'class' | 'top' | 'none' for the statement starting the line at `lineFrom`. */
function statementScope(state, lineFrom, lang) {
  return scopeAt(state.sliceDoc(Math.max(0, lineFrom - SCOPE_WINDOW), lineFrom), lang);
}

/**
 * Where to add a `;` after typing `typed` with the cursor at `head` in `doc`
 * (`scopeState` is a state with the same text above the line), or null.
 */
function insertionAt(doc, head, typed, lang, scopeState) {
  const line = doc.lineAt(head);
  const before = doc.sliceString(line.from, head);
  const after = doc.sliceString(head, line.to);
  // the line's own regex first; the code above only when it matched
  if (!autoSemicolon(before, after, typed, lang, 'body')) return null;
  if (!autoSemicolon(before, after, typed, lang, statementScope(scopeState, line.from, lang))) return null;
  return head + after.trimEnd().length;
}

const CONTINUATION = /^(?:\.|\?\.|->|<<|>>|&&|\|\||\?\?|\?|:)$/;

const filter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose')) return tr;
  const start = tr.startState;
  const f = start.field(semiField, false);
  if (!f || f.noSemi) return tr;
  const sel = tr.newSelection;
  if (sel.ranges.length > 1 || !sel.main.empty) return tr;
  let typed = '', count = 0;
  tr.changes.iterChanges((_a, _b, _c, _d, text) => { count++; typed = text.length ? text.sliceString(0, 1) : ''; });
  if (count !== 1) return tr;
  const head = sel.main.head;
  const doc = tr.newDoc;

  // A chain continued on the next line: take back the `;` Enter added.
  if (f.stepped != null) {
    const stepped = tr.changes.mapPos(f.stepped, 1);
    const line = doc.lineAt(head);
    if (CONTINUATION.test(doc.sliceString(line.from, head).trim()) && doc.sliceString(stepped, stepped + 1) === ';'
      && doc.sliceString(stepped + 1, doc.lineAt(stepped).to).trim() === '') {
      return [tr, { changes: { from: stepped, to: stepped + 1 }, effects: setStepped.of(null), sequential: true }];
    }
  }

  if (!TRIGGERS.has(typed) || f.pos != null || f.dismissed != null) return tr;
  const at = insertionAt(doc, head, typed, langOf(start), start);
  if (at == null) return tr;
  return [tr, { changes: { from: at, insert: ';' }, selection: { anchor: head }, effects: setPending.of({ pos: at, fresh: true }), sequential: true }];
});

/** Tab / swipe right / keys-bar Tab: jump past the pending `;`. */
export function jumpPastSemicolon(view) {
  const f = view && view.state.field(semiField, false);
  if (!f || f.pos == null || view.state.selection.main.head > f.pos) return false;
  view.dispatch({ selection: { anchor: f.pos + 1 }, effects: setPending.of(null), userEvent: 'select', scrollIntoView: true });
  return true;
}

/** Typing `;` steps over the pending one (and over auto-closed `)` `]` before it). */
const stepOverInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ';' || from !== to || view.state.selection.ranges.length > 1) return false;
  const f = view.state.field(semiField, false);
  if (!f || f.pos == null || from > f.pos || !/^[)\]]*$/.test(view.state.sliceDoc(from, f.pos))) return false;
  return jumpPastSemicolon(view);
});

function enter(view) {
  const { state } = view;
  const f = state.field(semiField, false);
  if (!f || completionStatus(state) === 'active') return false;
  const sel = state.selection;
  if (sel.ranges.length > 1 || !sel.main.empty) return false;
  const head = sel.main.head;
  const line = state.doc.lineAt(head);
  if (f.pos != null && f.pos >= head) {
    if (!enterStepsOver(state.sliceDoc(line.from, head), state.sliceDoc(head, f.pos))) return false;
    view.dispatch({ selection: { anchor: f.pos + 1 }, effects: [setPending.of(null), setStepped.of(f.pos)] });
    return insertNewlineAndIndent(view);
  }
  if (f.pos == null && f.dismissed == null && !f.noSemi && head === line.to && isBareJump(line.text)
    && statementScope(state, line.from, langOf(state)) === 'body') {
    view.dispatch({ changes: { from: head, insert: ';' }, selection: { anchor: head + 1 }, userEvent: 'input.type' });
    return insertNewlineAndIndent(view);
  }
  return false;
}

function backspace(view) {
  const { state } = view;
  const f = state.field(semiField, false);
  if (!f || !f.fresh || f.pos == null) return false;
  const sel = state.selection.main;
  if (state.selection.ranges.length > 1 || !sel.empty || sel.head !== f.pos) return false;
  view.dispatch({ changes: { from: f.pos, to: f.pos + 1 }, effects: [setPending.of(null), dismissLine.of(sel.head)], userEvent: 'delete.backward' });
  return true;
}

/** Catches up after an IME composition (see the header comment). */
const composeCatchUp = ViewPlugin.fromClass(class {
  constructor(view) { this.view = view; this.timer = 0; }
  update(u) {
    if (!u.transactions.some((tr) => tr.isUserEvent('input.type.compose'))) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), 150);
  }
  check() {
    const v = this.view;
    if (v.composing) { this.timer = setTimeout(() => this.check(), 150); return; }
    const f = v.state.field(semiField, false);
    const sel = v.state.selection;
    if (!f || f.noSemi || f.pos != null || f.dismissed != null || sel.ranges.length > 1 || !sel.main.empty) return;
    const head = sel.main.head;
    const typed = v.state.sliceDoc(Math.max(0, head - 1), head);
    const at = insertionAt(v.state.doc, head, typed, langOf(v.state), v.state);
    if (at == null) return;
    v.dispatch({ changes: { from: at, insert: ';' }, selection: { anchor: head }, effects: setPending.of({ pos: at, fresh: true }), userEvent: 'input.type' });
  }
  destroy() { clearTimeout(this.timer); }
});

/** The automatic-semicolon behaviour, for languages that use `;`. */
export function semicolonExtension(langId, enabled) {
  if (!enabled || !SEMICOLON_LANGS.has(langId)) return [];
  return [
    semiField,
    filter,
    stepOverInput,
    composeCatchUp,
    Prec.high(keymap.of([
      { key: 'Enter', run: enter },
      { key: 'Backspace', run: backspace },
      { key: 'Tab', run: (v) => completionStatus(v.state) !== 'active' && !hasNextSnippetField(v.state) && jumpPastSemicolon(v) },
    ])),
  ];
}

/**
 * "Complete statement" (⏎; key, Ctrl+Shift+Enter) — works with automatic
 * semicolons on or off: adds `;` if missing (`:` after a Python block
 * header, ` {}` after `if (…)` or a function header), closes a `(` left
 * open on the line, and starts a new line.
 */
export function completeStatement(view) {
  if (!view || view.state.readOnly) return null;
  const { state } = view;
  const lang = langOf(state);
  const line = state.doc.lineAt(state.selection.main.head);
  let code = codePart(line.text);
  const f = state.field(semiField, false);
  const pending = f && f.pos != null && f.pos === line.from + code.length - 1;
  if (pending) code = code.slice(0, -1);
  const end = line.from + code.length;
  const plan = completionPlan(code, lang, statementScope(state, line.from, lang));
  let append = plan.append;
  if (pending && append.endsWith(';')) append = append.slice(0, -1);
  const cursor = plan.block ? end + append.indexOf('}') : end + append.length + (pending ? 1 : 0);
  view.dispatch({
    changes: append ? { from: end, insert: append } : undefined,
    selection: { anchor: cursor },
    effects: f ? setPending.of(null) : [],
    userEvent: 'input',
    scrollIntoView: true,
  });
  insertNewlineAndIndent(view);
  return 'Statement completed';
}
