// editor/editActions.js — editing commands shared by the keys bar, gestures,
// the command palette and keyboard shortcuts. Each takes an EditorView and
// returns a short label describing what happened (shown as a gesture hint),
// or null if nothing happened.
//
// This is the "edits as data / command pattern" idea from spec Milestone 3:
// a command is a plain function; *what triggers it* (key, swipe, menu) is
// decided elsewhere.

import {
  undo as cmUndo, redo as cmRedo, indentMore, indentLess, toggleComment as cmToggleComment,
  copyLineDown, moveLineUp, moveLineDown, deleteLine as cmDeleteLine, selectAll as cmSelectAll,
  cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown, selectCharLeft, selectCharRight,
  selectLineUp, selectLineDown, cursorGroupLeft, cursorGroupRight, selectGroupLeft, selectGroupRight,
  deleteGroupBackward, deleteCharBackward, insertNewlineAndIndent, cursorLineBoundaryBackward,
  cursorLineBoundaryForward, selectLine, cursorDocStart, cursorDocEnd, selectLineBoundaryBackward,
  selectLineBoundaryForward, addCursorAbove, addCursorBelow, copyLineUp as cmCopyLineUp,
  cursorSubwordForward, cursorSubwordBackward, selectSubwordForward, selectSubwordBackward,
  simplifySelection, deleteCharForward, cursorPageUp, cursorPageDown, cursorMatchingBracket,
} from '@codemirror/commands';
import {
  completionStatus, acceptCompletion, startCompletion, closeCompletion, clearSnippet,
  hasNextSnippetField, hasPrevSnippetField, nextSnippetField, prevSnippetField,
} from '@codemirror/autocomplete';
import { openSearchPanel, closeSearchPanel, searchPanelOpen, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { EditorSelection } from '@codemirror/state';
import { gotoLine } from '@codemirror/search';
import { indentUnit, getIndentUnit } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { expandSelection as cmExpand, shrinkSelection as cmShrink } from './selection.js';
import { jumpPastSemicolon } from './semicolons.js';

const run = (cmd, label) => (view) => (view && !view.state.readOnly && cmd(view) ? label : null);
const runRO = (cmd, label) => (view) => (view && cmd(view) ? label : null);

/** Swipe right: accept the suggestion → else next snippet field → else jump
 * past an automatic `;` → else open suggestions. */
export function autocomplete(view) {
  if (!view || view.state.readOnly) return null;
  if (completionStatus(view.state) === 'active' && acceptCompletion(view)) return 'Completed';
  if (hasNextSnippetField(view.state) && nextSnippetField(view)) return 'Next field';
  if (jumpPastSemicolon(view)) return 'Past ;';
  if (startCompletion(view)) return 'Suggestions';
  return null;
}

/** Swipe left: close suggestions → else previous snippet field → else delete word. */
export function dismissOrDeleteWord(view) {
  if (!view || view.state.readOnly) return null;
  if (completionStatus(view.state) !== null && closeCompletion(view)) return 'Closed list';
  if (hasPrevSnippetField(view.state) && prevSnippetField(view)) return 'Previous field';
  if (!view.state.selection.main.empty) {
    view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.selection', scrollIntoView: true });
    return 'Deleted selection';
  }
  return deleteGroupBackward(view) ? 'Deleted word' : null;
}

export const undo = run(cmUndo, 'Undo');
export const redo = run(cmRedo, 'Redo');
export const indent = run(indentMore, 'Indent');
export const outdent = run(indentLess, 'Outdent');
export const toggleComment = run(cmToggleComment, 'Toggle comment');
export const duplicateLine = run(copyLineDown, 'Duplicate line');
export const lineUp = run(moveLineUp, 'Move line up');
export const lineDown = run(moveLineDown, 'Move line down');
export const deleteLine = run(cmDeleteLine, 'Delete line');
export const selectAll = runRO(cmSelectAll, 'Select all');
export const selectLineCmd = runRO(selectLine, 'Select line');
export const expandSelection = runRO(cmExpand, 'Expand selection');
export const shrinkSelection = runRO(cmShrink, 'Shrink selection');
export const newlineBelow = run((v) => {
  cursorLineBoundaryForward(v);
  return insertNewlineAndIndent(v);
}, 'New line');
export const backspace = run(deleteCharBackward, 'Backspace');
export const deleteForward = run(deleteCharForward, 'Delete');
export const copyLineUp = run(cmCopyLineUp, 'Copy line up');
export const pageUp = runRO(cursorPageUp, 'Page up');
export const pageDown = runRO(cursorPageDown, 'Page down');
export const matchingBracket = runRO(cursorMatchingBracket, 'Matching bracket');

/** A new, indented line above the cursor's line (VS Code: Ctrl+Shift+Enter; here Ctrl+Alt+Enter). */
export const newlineAbove = run((view) => {
  const { state } = view;
  view.dispatch(state.changeByRange((r) => {
    const line = state.doc.lineAt(r.head);
    const indent = /^\s*/.exec(line.text)[0];
    return { changes: { from: line.from, insert: indent + state.lineBreak }, range: EditorSelection.cursor(line.from + indent.length) };
  }), { scrollIntoView: true, userEvent: 'input' });
  return true;
}, 'New line above');

/** Joins the cursor's line with the next one (one space between, the next line's indent dropped). */
export const joinLines = run((view) => {
  const { state } = view;
  const { doc } = state;
  let joined = false;
  const tr = state.changeByRange((r) => {
    const line = doc.lineAt(r.head);
    if (line.number >= doc.lines) return { range: r };
    const next = doc.line(line.number + 1);
    const lead = /^\s*/.exec(next.text)[0].length;
    const sep = !line.text.trim() || /\s$/.test(line.text) || !next.text.trim() ? '' : ' ';
    joined = true;
    return { changes: { from: line.to, to: next.from + lead, insert: sep }, range: EditorSelection.cursor(line.to) };
  });
  if (!joined) return false;
  view.dispatch(tr, { scrollIntoView: true, userEvent: 'delete' });
  return true;
}, 'Joined lines');

/** The word at the cursor (keys-bar joystick tap). */
export const selectWord = runRO((view) => {
  const { state } = view;
  const head = state.selection.main.head;
  const w = state.wordAt(head) || (head > 0 ? state.wordAt(head - 1) : null);
  if (!w) return false;
  view.dispatch({ selection: EditorSelection.range(w.from, w.to), userEvent: 'select' });
  return true;
}, 'Word selected');

/** Every occurrence of the selection (or of the word at the cursor). */
export const selectAllMatches = runRO((view) => {
  if (view.state.selection.main.empty) selectNextOccurrence(view);
  return selectSelectionMatches(view);
}, 'All occurrences');

/** Is there anything Esc would close or collapse? (The keys bar shows Esc then.) */
export function escapable(state) {
  return completionStatus(state) !== null || searchPanelOpen(state) || hasNextSnippetField(state) || hasPrevSnippetField(state)
    || state.selection.ranges.length > 1 || !state.selection.main.empty;
}

/** Esc: suggestions → find panel → snippet → several cursors → selection. */
export function escape(view) {
  if (!view) return null;
  const { state } = view;
  if (completionStatus(state) !== null && closeCompletion(view)) return 'Closed list';
  if (searchPanelOpen(state) && closeSearchPanel(view)) return 'Closed find';
  if ((hasNextSnippetField(state) || hasPrevSnippetField(state)) && clearSnippet(view)) return 'Left snippet';
  if (state.selection.ranges.length > 1 && simplifySelection(view)) return 'One cursor';
  const m = state.selection.main;
  if (!m.empty) { view.dispatch({ selection: EditorSelection.cursor(m.head), userEvent: 'select' }); return 'Deselected'; }
  return null;
}
export const goLineStart = runRO(cursorLineBoundaryBackward, 'Line start');
export const goLineEnd = runRO(cursorLineBoundaryForward, 'Line end');
export const goDocStart = runRO(cursorDocStart, 'Top');
export const goDocEnd = runRO(cursorDocEnd, 'Bottom');
export const find = runRO((v) => (searchPanelOpen(v.state) ? closeSearchPanel(v) : openSearchPanel(v)), 'Find');
export const goToLinePanel = runRO(gotoLine, 'Go to line');

// ---- multi-line editing (several cursors) ------------------------------------
// Everything typed then goes to every cursor; tap the text to get back to one.

const cursorCount = (view) => `${view.state.selection.ranges.length} cursors`;
export const addCursorDown = (view) => (view && addCursorBelow(view) ? cursorCount(view) : null);
export const addCursorUp = (view) => (view && addCursorAbove(view) ? cursorCount(view) : null);
/** Selects the word under the cursor, then each next occurrence of it (Ctrl+D). */
export const selectNext = (view) => (view && selectNextOccurrence(view) ? (view.state.selection.ranges.length > 1 ? cursorCount(view) : 'Word selected') : null);

/**
 * A cursor at the end of every selected line (VS Code: Shift+Alt+I). Select
 * lines by dragging down the line numbers, then type on all of them at once.
 */
export function cursorsOnLines(view) {
  if (!view) return null;
  const { state } = view;
  const ranges = [];
  for (const r of state.selection.ranges) {
    if (r.empty) { ranges.push(r); continue; }
    const first = state.doc.lineAt(r.from);
    const last = state.doc.lineAt(r.to);
    // a whole-line selection ends at the start of the next line: not that line
    const lastNo = r.to === last.from && last.number > first.number ? last.number - 1 : last.number;
    for (let n = first.number; n <= lastNo; n++) ranges.push(EditorSelection.cursor(state.doc.line(n).to));
  }
  if (ranges.length < 2) return null;
  view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1), scrollIntoView: true, userEvent: 'select' });
  return cursorCount(view);
}

/**
 * Arrow keys with the keys-bar modifiers: Shift extends, Ctrl jumps words,
 * Alt moves lines (↑↓) or jumps by word part (←→, e.g. inside camelCase).
 */
export function arrow(view, dir, { shift = false, ctrl = false, alt = false } = {}) {
  if (!view) return null;
  if (alt && (dir === 'up' || dir === 'down')) return (dir === 'up' ? lineUp : lineDown)(view);
  const sub = alt && !ctrl;
  const table = {
    left: sub ? (shift ? selectSubwordBackward : cursorSubwordBackward) : shift ? (ctrl ? selectGroupLeft : selectCharLeft) : (ctrl ? cursorGroupLeft : cursorCharLeft),
    right: sub ? (shift ? selectSubwordForward : cursorSubwordForward) : shift ? (ctrl ? selectGroupRight : selectCharRight) : (ctrl ? cursorGroupRight : cursorCharRight),
    up: shift ? selectLineUp : cursorLineUp,
    down: shift ? selectLineDown : cursorLineDown,
    home: shift ? selectLineBoundaryBackward : cursorLineBoundaryBackward,
    end: shift ? selectLineBoundaryForward : cursorLineBoundaryForward,
  };
  const cmd = table[dir];
  return cmd && cmd(view) ? dir : null;
}

/**
 * Inserts text exactly as if it was typed on a keyboard: it goes through the
 * same input handlers as real typing (EditorView.inputHandler), so the
 * keys bar gets auto-closed brackets and quotes, `>` closing an HTML tag,
 * `;` stepping over a pending semicolon — whatever is enabled — and the edit
 * is marked as typing so suggestions react to it.
 */
export function typeText(view, text) {
  if (!view || view.state.readOnly) return null;
  const { from, to } = view.state.selection.main;
  const insert = () => view.state.update(view.state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true });
  for (const handler of view.state.facet(EditorView.inputHandler)) {
    if (handler(view, from, to, text, insert)) return text;
  }
  view.dispatch(insert());
  return text;
}

export function hideKeyboard(view) {
  if (!view) return null;
  view.contentDOM.blur();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  return 'Keyboard hidden';
}

/** The keys-bar Tab: accepts a suggestion, moves to the next snippet field or
 * past an automatic `;`;
 * otherwise indents a selection, or inserts one indent step
 * (spaces up to the next tab stop, or a real tab — per the file's settings). */
export function tabKey(view) {
  if (!view || view.state.readOnly) return null;
  // Like a keyboard Tab: accept the suggestion / go to the next snippet field first.
  if (completionStatus(view.state) === 'active' && acceptCompletion(view)) return 'Completed';
  if (hasNextSnippetField(view.state) && nextSnippetField(view)) return 'Next field';
  if (jumpPastSemicolon(view)) return 'Past ;';
  const { state } = view;
  if (state.selection.ranges.some((r) => !r.empty)) return indent(view);
  const unit = state.facet(indentUnit);
  if (unit === '\t') return typeText(view, '\t') && 'Tab';
  const size = getIndentUnit(state);
  const head = state.selection.main.head;
  const col = head - state.doc.lineAt(head).from;
  return typeText(view, ' '.repeat(size - (col % size))) && 'Tab';
}
