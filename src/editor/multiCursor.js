// editor/multiCursor.js — with several cursors (a snippet's linked fields,
// Ctrl+D / "Sel+" selections), typing reaches all of them, whichever way the
// keyboard delivers it.
//
// Android keyboards type through "compositions" (the underlined word).
// CodeMirror copies a composition edit to the other cursors, except those in
// the DOM text node being composed (changing that node would abort the
// composition). When it can't find that node — seen in Firefox for Android —
// it skips every cursor on the line, so in `for (let index = 0; index < n;
// index++)` only the first `index` changed. The input handler below runs
// after every other one and completes such an edit: where the main cursor's
// change replaced text that another cursor also has, that cursor gets the
// same change. It keeps CodeMirror's rule, checked per text node instead of
// per line.

import { EditorView, ViewPlugin } from '@codemirror/view';
import { EditorSelection, ChangeSet, StateEffect, Transaction, Prec } from '@codemirror/state';

/**
 * The change `tr` made at the main selection range, repeated at the other
 * ranges it left alone (those holding the same text, around which the same
 * text would be replaced). `canEdit(range)` may veto a range.
 * → a transaction spec for `start` (tr's changes plus the copies), or null.
 */
export function mirrorToRanges(start, tr, canEdit = () => true) {
  const sel = start.selection;
  if (sel.ranges.length < 2 || !tr.docChanged) return null;
  const main = sel.main;
  const changes = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, insert) => changes.push({ from, to, insert }));
  const m = changes.find((c) => c.from <= main.to && c.to >= main.from);
  if (!m) return null;
  const touches = (a, from, to) => a.from <= to && from <= a.to;
  const lead = main.from - m.from, tail = m.to - main.to;
  const replaced = start.sliceDoc(m.from, m.to), mainText = start.sliceDoc(main.from, main.to);
  const extra = [];
  // where each range's change is (its start, in `start`), or null: not changed like the main one
  const at = sel.ranges.map((r, i) => {
    if (i === sel.mainIndex) return m.from;
    const from = r.from - lead, to = r.to + tail;
    if (from < 0 || to > start.doc.length || to < from) return null;
    if (start.sliceDoc(r.from, r.to) !== mainText || start.sliceDoc(from, to) !== replaced) return null;
    const hit = changes.find((c) => touches(c, from, to));
    if (hit) return hit.from === from && hit.to === to ? from : null; // CodeMirror did it already
    if (extra.some((e) => touches(e, from, to)) || !canEdit(r)) return null;
    extra.push({ from, to, insert: m.insert });
    return from;
  });
  if (!extra.length) return null;
  // the copies, after tr's own changes
  const extraB = ChangeSet.of(extra.map((e) => ({ from: tr.changes.mapPos(e.from, 1), to: tr.changes.mapPos(e.to, -1), insert: e.insert })), tr.newDoc.length);
  const all = tr.changes.compose(extraB);
  // every changed range ends up where the main one did, relative to its change
  const newMain = tr.newSelection.main;
  const mainAt = tr.changes.mapPos(m.from, -1);
  const relAnchor = newMain.anchor - mainAt, relHead = newMain.head - mainAt;
  const ranges = sel.ranges.map((r, i) => {
    if (at[i] == null) return r.map(all);
    const s = all.mapPos(at[i], -1);
    return EditorSelection.range(s + relAnchor, s + relHead);
  });
  return {
    changes: all,
    selection: EditorSelection.create(ranges, sel.mainIndex),
    effects: StateEffect.mapEffects(tr.effects, extraB),
    userEvent: tr.annotation(Transaction.userEvent),
    scrollIntoView: true,
  };
}

/** The DOM text node at a document position (approximately: the one the browser edits there). */
function textNodeAt(view, pos) {
  try {
    let { node, offset } = view.domAtPos(pos);
    if (node.nodeType !== 3) node = node.childNodes[offset] || node.childNodes[offset - 1] || node;
    while (node && node.nodeType !== 3 && node.firstChild) node = node.firstChild;
    return node;
  } catch { return null; }
}

export const mirrorTyping = Prec.lowest(EditorView.inputHandler.of((view, _from, _to, _text, insert) => {
  const start = view.state;
  if (start.selection.ranges.length < 2) return false;
  const composing = view.composing ? textNodeAt(view, start.selection.main.head) : null;
  const spec = mirrorToRanges(start, insert(), (r) => !composing || textNodeAt(view, r.head) !== composing);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}));

const FIREFOX_ANDROID = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent) && /Firefox\//.test(navigator.userAgent);

/**
 * Firefox for Android opens its floating "Copy · Select all · Share" bar
 * (and selection handles) when a script selects text while its caret handle
 * is showing: Ctrl+D, a snippet's field, the joystick's tap. Firefox hides
 * its handles whenever a selection gets collapsed (as after Cut or Copy), and
 * then leaves a script's selection alone; so the page's selection is
 * collapsed just before CodeMirror sets the new one. A selection the user
 * makes by long-pressing is already on the page and left as it is (the bar is
 * useful there).
 */
export const quietSelectionBar = FIREFOX_ANDROID ? ViewPlugin.fromClass(class {
  update(u) {
    const main = u.state.selection.main;
    if (!u.selectionSet || main.empty || !u.view.hasFocus) return;
    const dom = document.getSelection();
    if (!dom || !dom.rangeCount || !u.view.contentDOM.contains(dom.focusNode)) return;
    if (!dom.isCollapsed) {
      try {
        const a = u.view.posAtDOM(dom.anchorNode, dom.anchorOffset), h = u.view.posAtDOM(dom.focusNode, dom.focusOffset);
        if (Math.min(a, h) === main.from && Math.max(a, h) === main.to) return; // the user's own selection
      } catch { /* outside the content */ }
    }
    try { dom.collapseToEnd(); } catch { /* nothing selected */ }
  }
}) : [];
