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
  selectLineBoundaryForward,
} from '@codemirror/commands';
import {
  completionStatus, acceptCompletion, startCompletion, closeCompletion,
  hasNextSnippetField, hasPrevSnippetField, nextSnippetField, prevSnippetField, insertBracket,
} from '@codemirror/autocomplete';
import { openSearchPanel, closeSearchPanel, searchPanelOpen } from '@codemirror/search';
import { gotoLine } from '@codemirror/search';
import { indentUnit, getIndentUnit } from '@codemirror/language';
import { expandSelection as cmExpand, shrinkSelection as cmShrink } from './selection.js';

const run = (cmd, label) => (view) => (view && !view.state.readOnly && cmd(view) ? label : null);
const runRO = (cmd, label) => (view) => (view && cmd(view) ? label : null);

/** Swipe right: accept the suggestion → else next snippet field → else open suggestions. */
export function autocomplete(view) {
  if (!view || view.state.readOnly) return null;
  if (completionStatus(view.state) === 'active' && acceptCompletion(view)) return 'Completed';
  if (hasNextSnippetField(view.state) && nextSnippetField(view)) return 'Next field';
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
export const goLineStart = runRO(cursorLineBoundaryBackward, 'Line start');
export const goLineEnd = runRO(cursorLineBoundaryForward, 'Line end');
export const goDocStart = runRO(cursorDocStart, 'Top');
export const goDocEnd = runRO(cursorDocEnd, 'Bottom');
export const find = runRO((v) => (searchPanelOpen(v.state) ? closeSearchPanel(v) : openSearchPanel(v)), 'Find');
export const goToLinePanel = runRO(gotoLine, 'Go to line');

/** Arrow keys with the keys-bar modifiers (Shift extends, Ctrl jumps words, Alt moves lines). */
export function arrow(view, dir, { shift = false, ctrl = false, alt = false } = {}) {
  if (!view) return null;
  if (alt && (dir === 'up' || dir === 'down')) return (dir === 'up' ? lineUp : lineDown)(view);
  const table = {
    left: shift ? (ctrl ? selectGroupLeft : selectCharLeft) : (ctrl ? cursorGroupLeft : cursorCharLeft),
    right: shift ? (ctrl ? selectGroupRight : selectCharRight) : (ctrl ? cursorGroupRight : cursorCharRight),
    up: shift ? selectLineUp : cursorLineUp,
    down: shift ? selectLineDown : cursorLineDown,
    home: shift ? selectLineBoundaryBackward : cursorLineBoundaryBackward,
    end: shift ? selectLineBoundaryForward : cursorLineBoundaryForward,
  };
  const cmd = table[dir];
  return cmd && cmd(view) ? dir : null;
}

/**
 * Inserts text as if typed: auto-closes brackets/quotes (when enabled) and
 * marks the edit as typing so autocompletion reacts to it.
 */
export function typeText(view, text, { autoClose = true } = {}) {
  if (!view || view.state.readOnly) return null;
  if (autoClose && text.length === 1) {
    const tr = insertBracket(view.state, text);
    if (tr) { view.dispatch(tr); return text; }
  }
  view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true });
  return text;
}

export function hideKeyboard(view) {
  if (!view) return null;
  view.contentDOM.blur();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  return 'Keyboard hidden';
}

/** The keys-bar Tab: indents a selection, otherwise inserts one indent step
 * (spaces up to the next tab stop, or a real tab — per the file's settings). */
export function tabKey(view) {
  if (!view || view.state.readOnly) return null;
  const { state } = view;
  if (state.selection.ranges.some((r) => !r.empty)) return indent(view);
  const unit = state.facet(indentUnit);
  if (unit === '\t') return typeText(view, '\t', { autoClose: false }) && 'Tab';
  const size = getIndentUnit(state);
  const head = state.selection.main.head;
  const col = head - state.doc.lineAt(head).from;
  return typeText(view, ' '.repeat(size - (col % size)), { autoClose: false }) && 'Tab';
}
