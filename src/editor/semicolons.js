// editor/semicolons.js — automatic ("pending") semicolons and the "Complete
// statement" command. The rules — which statements want a `;` — are in
// core/semicolons.js; this file is the editing behaviour around them:
//
//   • Typing a statement that needs `;` at the end of a line (`int x = `,
//     `return `, `foo(`, `std::cout << `…) inserts a faded `;` after the
//     cursor, in the same undo step as the typing.
//   • The `;` is re-checked on every edit of its statement, and removed if
//     the statement turns out not to need one (`int main(` → a function
//     header). Once the cursor leaves the line it is an ordinary `;`.
//   • Typing `;` steps over it (also over auto-closed `)`/`]` before it).
//   • Enter steps over it and opens a new line — only when the statement is
//     complete. Otherwise Enter breaks the line and the `;` stays at the end.
//   • Backspace right after it appeared removes it, and no `;` is added on
//     that line again until the cursor leaves it.
//   • A chain continued on the next line (`.then(…)`, `<< x`) removes the
//     `;` Enter just stepped over.
//
// Android keyboards type words in "composition" mode; changing text next to
// a word being composed can confuse them, so during composition nothing is
// inserted — a small plugin catches up once the composition ends.

import { EditorView, Decoration, ViewPlugin, keymap } from '@codemirror/view';
import { EditorState, StateField, StateEffect, Prec } from '@codemirror/state';
import { insertNewlineAndIndent } from '@codemirror/commands';
import { completionStatus } from '@codemirror/autocomplete';
import { docInfo } from './context.js';
import {
  SEMICOLON_LANGS, isJsLike, wantsSemicolon, canStepOver, isBareJump, completionPlan, prefersNoSemicolons,
} from '../core/semicolons.js';

const WINDOW = 20000; // chars of code before the cursor the rules look at

const setPending = StateEffect.define();   // {pos, fresh}
const dismissLine = StateEffect.define();  // pos on the line
const setStepped = StateEffect.define();   // pos of a `;` Enter stepped over

/**
 * {pos, fresh, dismissed, stepped, noSemi}
 *   pos       the pending `;` (null if none)
 *   fresh     it was inserted by the previous transaction (for Backspace)
 *   dismissed a position on a line where the user removed it with Backspace
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
    const { doc, selection } = tr.state;
    const head = selection.main.head;
    const headLine = doc.lineAt(head).number;
    if (pos != null && (pos >= doc.length || doc.sliceString(pos, pos + 1) !== ';' || pos < head || doc.lineAt(pos).number !== headLine)) {
      pos = null; // removed, or the cursor moved on: it's an ordinary `;` now
    }
    if (dismissed != null && doc.lineAt(Math.min(dismissed, doc.length)).number !== headLine) dismissed = null;
    if (stepped != null) {
      // valid while the cursor is on the stepped line (Enter is about to
      // open the next one) or on the next line, before it has real content
      const ok = stepped < doc.length && doc.sliceString(stepped, stepped + 1) === ';';
      const line = ok ? doc.lineAt(stepped).number : -1;
      if (!ok || (line !== headLine && (line !== headLine - 1 || doc.lineAt(head).text.trim().length > 3))) stepped = null;
    }
    if (pos === v.pos && fresh === v.fresh && dismissed === v.dismissed && stepped === v.stepped && noSemi === v.noSemi) return v;
    return { pos, fresh, dismissed, stepped, noSemi };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => (v.pos == null ? Decoration.none : Decoration.set([pendingMark.range(v.pos, v.pos + 1)]))),
});

const pendingMark = Decoration.mark({ class: 'cm-pending-semi', attributes: { title: 'Added automatically — type ; or press Enter to keep, Backspace to remove' } });

function detectNoSemi(state) {
  const info = state.facet(docInfo);
  return !!info && isJsLike(info.langId) && prefersNoSemicolons(state.sliceDoc(0, Math.min(state.doc.length, 200000)));
}

const langOf = (state) => (state.facet(docInfo) || {}).langId;
const before = (state, pos) => state.sliceDoc(Math.max(0, pos - WINDOW), pos);

/** A `;` to add after the cursor in this state, or null. */
function insertionFor(state) {
  const f = state.field(semiField, false);
  if (!f || f.pos != null || f.dismissed != null || f.noSemi) return null;
  const sel = state.selection;
  if (sel.ranges.length > 1 || !sel.main.empty) return null;
  const head = sel.main.head;
  const line = state.doc.lineAt(head);
  const after = state.sliceDoc(head, line.to);
  if (!wantsSemicolon(before(state, head), after, langOf(state))) return null;
  return head + after.trimEnd().length;
}

const CONTINUATION = /^(?:\.|\?\.|->|<<|>>|&&|\|\||\?\?|\?|:)$/;

const filter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent('input') || tr.isUserEvent('delete'))) return tr;
  const state = tr.state;
  const f = state.field(semiField, false);
  if (!f) return tr;
  const sel = state.selection;
  if (sel.ranges.length > 1 || !sel.main.empty) return tr;
  const lang = langOf(state);
  const head = sel.main.head;

  // 1. Re-check the pending `;`: does its statement still want one?
  if (f.pos != null) {
    if (!wantsSemicolon(before(state, f.pos), '', lang)) {
      return [tr, { changes: { from: f.pos, to: f.pos + 1 }, effects: setPending.of(null), sequential: true }];
    }
    return tr;
  }

  const typing = tr.isUserEvent('input.type') && !tr.isUserEvent('input.type.compose');
  if (!typing) return tr;

  // 2. A chain continued on the next line: take back the `;` Enter added.
  if (f.stepped != null) {
    const line = state.doc.lineAt(head);
    const typed = state.sliceDoc(line.from, head).trim();
    if (CONTINUATION.test(typed) && state.sliceDoc(f.stepped + 1, state.doc.lineAt(f.stepped).to).trim() === '') {
      return [tr, { changes: { from: f.stepped, to: f.stepped + 1 }, effects: setStepped.of(null), sequential: true }];
    }
  }

  // 3. Add a pending `;` — only after a non-word character, so it doesn't
  //    flicker while a name is being typed (`int m` → `int main(`).
  let last = '';
  tr.changes.iterChanges((_a, _b, _c, _d, text) => { if (text.length) last = text.sliceString(text.length - 1); });
  if (!last || /[\w$]/.test(last)) return tr;
  const at = insertionFor(state);
  if (at == null) return tr;
  return [tr, { changes: { from: at, insert: ';' }, selection: { anchor: head }, effects: setPending.of({ pos: at, fresh: true }), sequential: true }];
});

/** Typing `;` steps over the pending one (and over auto-closed `)` `]` before it). */
const stepOverInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ';' || from !== to || view.state.selection.ranges.length > 1) return false;
  const f = view.state.field(semiField, false);
  if (!f || f.pos == null || from > f.pos) return false;
  const between = view.state.sliceDoc(from, f.pos);
  if (!/^[)\]]*$/.test(between)) return false;
  if (between && !canStepOver(before(view.state, from), between, langOf(view.state))) return false;
  view.dispatch({ selection: { anchor: f.pos + 1 }, effects: setPending.of(null), userEvent: 'select', scrollIntoView: true });
  return true;
});

function enter(view) {
  const { state } = view;
  const f = state.field(semiField, false);
  if (!f || completionStatus(state) === 'active') return false;
  const sel = state.selection;
  if (sel.ranges.length > 1 || !sel.main.empty) return false;
  const head = sel.main.head;
  const lang = langOf(state);
  if (f.pos != null && f.pos >= head) {
    if (!canStepOver(before(state, head), state.sliceDoc(head, f.pos), lang)) return false;
    view.dispatch({ selection: { anchor: f.pos + 1 }, effects: [setPending.of(null), setStepped.of(f.pos)] });
    return insertNewlineAndIndent(view);
  }
  if (f.pos == null && f.dismissed == null && !f.noSemi) {
    const line = state.doc.lineAt(head);
    if (state.sliceDoc(head, line.to).trim() === '' && isBareJump(before(state, head), lang)) {
      view.dispatch({ changes: { from: head, insert: ';' }, selection: { anchor: head + 1 }, userEvent: 'input.type' });
      return insertNewlineAndIndent(view);
    }
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
    const head = v.state.selection.main.head;
    const prev = v.state.sliceDoc(Math.max(0, head - 1), head);
    if (!prev || /[\w$]/.test(prev)) return;
    const at = insertionFor(v.state);
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
    Prec.high(keymap.of([{ key: 'Enter', run: enter }, { key: 'Backspace', run: backspace }])),
  ];
}

/**
 * "Complete statement" (⏎; key, Ctrl+Shift+Enter) — works with automatic
 * semicolons on or off: adds `;` if missing (`:` after a Python block
 * header, ` {}` after `if (…)` or a function header) and starts a new line.
 */
export function completeStatement(view) {
  if (!view || view.state.readOnly) return null;
  const { state } = view;
  const lang = langOf(state);
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  let end = line.from + line.text.trimEnd().length;
  const f = state.field(semiField, false);
  if (f && f.pos != null && f.pos === end - 1) end = f.pos; // the pending `;` counts as present
  const plan = completionPlan(before(state, end), lang);
  let append = plan.append;
  if (f && f.pos != null && f.pos === end && append.endsWith(';')) append = append.slice(0, -1);
  const cursor = plan.block ? end + append.indexOf('}') : end + append.length + (f && f.pos === end ? 1 : 0);
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
