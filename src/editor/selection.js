// editor/selection.js — Expand / shrink selection (spec §2 Phase 2, §3.2).
//
// The best fix for imprecise finger selection: each tap grows the selection to
// the next enclosing syntax node — word → expression → statement → block →
// function — instead of dragging tiny handles. "Shrink" walks back down the
// same steps, so the previous selections are remembered in a state field.

import { EditorSelection, StateField, StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

const pushSel = StateEffect.define();
const popSel = StateEffect.define();

/** Stack of earlier selections; cleared by any non-expand selection change. */
export const expandStack = StateField.define({
  create: () => [],
  update(stack, tr) {
    for (const e of tr.effects) {
      if (e.is(pushSel)) return [...stack, e.value];
      if (e.is(popSel)) return stack.slice(0, -1);
    }
    if (tr.selection || tr.docChanged) return [];
    return stack;
  },
});

const OPEN = '([{<"\'`';
const CLOSE = ')]}>"\'`';

function grow(state, range) {
  const { from, to } = range;
  // Step 1: a bare cursor first selects the word under it.
  if (from === to) {
    const word = state.wordAt(from);
    if (word && word.from < word.to) return word;
  }
  const tree = syntaxTree(state);
  let node = tree.resolveInner(from, 1);
  // Walk up until the node is strictly larger than the selection.
  for (;;) {
    if (node.from <= from && node.to >= to && (node.from < from || node.to > to)) {
      // Step 2: for bracketed nodes, select the inside first, then the brackets.
      const text = state.sliceDoc(node.from, node.to);
      const o = OPEN.indexOf(text[0]);
      if (text.length >= 2 && o >= 0 && text[text.length - 1] === CLOSE[o]) {
        const inner = { from: node.from + 1, to: node.to - 1 };
        if (inner.from <= from && inner.to >= to && (inner.from < from || inner.to > to)) return inner;
      }
      // Step 3: whole lines once we're at statement level.
      return { from: node.from, to: node.to };
    }
    if (!node.parent) break;
    node = node.parent;
  }
  return { from: 0, to: state.doc.length };
}

export function expandSelection(view) {
  const { state } = view;
  const next = EditorSelection.create(
    state.selection.ranges.map((r) => {
      const g = grow(state, r);
      return EditorSelection.range(g.from, g.to);
    }),
    state.selection.mainIndex,
  );
  if (next.eq(state.selection)) return false;
  view.dispatch({
    selection: next,
    effects: pushSel.of(state.selection),
    userEvent: 'select.expand',
    scrollIntoView: true,
  });
  return true;
}

export function shrinkSelection(view) {
  const stack = view.state.field(expandStack, false);
  if (!stack || !stack.length) return false;
  view.dispatch({
    selection: stack[stack.length - 1],
    effects: popSel.of(null),
    userEvent: 'select.shrink',
  });
  return true;
}
