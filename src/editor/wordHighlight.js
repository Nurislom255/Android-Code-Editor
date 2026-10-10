// editor/wordHighlight.js — with the cursor on a name (a variable, function,
// property, type), the other uses of that name on screen are lightly
// highlighted, like VS Code's word highlight.
//
// The syntax tree says what a name is, so "total" inside a string or a
// comment doesn't light up, and neither do keywords. Files without a
// language (plain text) compare whole words instead. While typing nothing is
// lit (a half-typed name would flicker); the highlight comes back a moment
// after the last keystroke.

import { ViewPlugin, Decoration } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { syntaxTree, language } from '@codemirror/language';

const NAME = /name|identifier|definition/i;
// markup names: every <div> or class= in the page lighting up is just noise
const NOT_NAMES = new Set(['TagName', 'AttributeName', 'MatchingTagName', 'MismatchedCloseTag']);
const MAX_NAME = 100;
const AFTER_TYPING = 350; // ms

const mark = Decoration.mark({ class: 'cm-wordHighlight' });
const refresh = StateEffect.define();

const isName = (type) => NAME.test(type.name) && !NOT_NAMES.has(type.name);

/** The name node under the cursor (touching it on either side), or null. */
export function nameAt(state, pos) {
  const tree = syntaxTree(state);
  for (const side of [-1, 1]) {
    const node = tree.resolveInner(pos, side);
    if (isName(node.type) && node.from <= pos && node.to >= pos && node.to > node.from && node.to - node.from <= MAX_NAME) return node;
  }
  return null;
}

/** [from, to] of every use of the name under the cursor in [from, to). */
export function nameUses(state, from = 0, to = state.doc.length) {
  const sel = state.selection.main;
  if (!sel.empty) return [];
  const pos = sel.head;
  const out = [];
  if (!state.facet(language)) {
    // plain text: whole words
    const word = state.wordAt(pos);
    if (!word || word.to - word.from > MAX_NAME) return [];
    const text = state.sliceDoc(word.from, word.to);
    const re = new RegExp(`(?<![\\w$])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g');
    const chunk = state.sliceDoc(from, to);
    for (let m; (m = re.exec(chunk));) out.push([from + m.index, from + m.index + text.length]);
    return out;
  }
  const node = nameAt(state, pos);
  if (!node) return [];
  const text = state.sliceDoc(node.from, node.to);
  const len = text.length;
  syntaxTree(state).iterate({
    from, to,
    enter: (n) => {
      if (n.to - n.from === len && isName(n.type) && state.sliceDoc(n.from, n.to) === text) out.push([n.from, n.to]);
    },
  });
  return out;
}

function decorations(view) {
  const ranges = [];
  for (const { from, to } of view.visibleRanges) {
    for (const [a, b] of nameUses(view.state, from, to)) ranges.push(mark.range(a, b));
  }
  return Decoration.set(ranges, true);
}

export const wordHighlight = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.timer = 0;
    this.decorations = decorations(view);
  }

  update(u) {
    // Typing, or a word still being composed by the keyboard (underlined on
    // Android): no marks — wrapping the word being composed in new elements
    // can make the keyboard lose its place.
    if (u.docChanged || u.view.composing) {
      this.decorations = Decoration.none;
      this.later();
      return;
    }
    const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)));
    if (refreshed || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      this.decorations = decorations(u.view);
    }
  }

  later() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.view.composing) this.later();
      else this.view.dispatch({ effects: refresh.of(null) });
    }, AFTER_TYPING);
  }

  destroy() { clearTimeout(this.timer); }
}, { decorations: (p) => p.decorations });
