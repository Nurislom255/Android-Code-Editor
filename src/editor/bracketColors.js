// editor/bracketColors.js — VS Code's coloured bracket pairs and indent guides.
//
// Bracket pairs: ( [ { are coloured by how deeply they are nested (gold,
// orchid, blue, then again), and a closer with nothing to close is red.
// Brackets inside strings and comments don't count.
//
//   Languages with a real parser (JavaScript, Python, CSS…): the syntax tree
//   marks bracket tokens (NodeProp.closedBy / openedBy), so `"("` in a string
//   is never one. Only the part of the tree on screen is walked: a subtree
//   that ends above the screen holds matched pairs, so it is skipped whole.
//   Simple-mode languages and plain text: the text is scanned, skipping what
//   the highlighter calls a string or comment.
//
// Indent guides: thin vertical lines at each indentation level, drawn as a
// background on the line (no extra elements). A blank line takes its guides
// from the lines around it, as in VS Code.

import { ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder, StateEffect, countColumn } from '@codemirror/state';
import { syntaxTree, language, StreamLanguage, getIndentUnit } from '@codemirror/language';
import { NodeProp } from '@lezer/common';

export const DEPTH_COLORS = 3;
const OPEN = '([{';
const CLOSE = ')]}';
const SCAN_LIMIT = 300000; // chars scanned before the screen (simple modes / plain text)

/**
 * Pure: brackets in `text` (starting at document offset `offset`) with their
 * colour level. `stack` carries the openers still unclosed before `offset` and
 * is updated in place. `skip(pos)` says a position is inside a string/comment.
 * @returns {{pos:number, level:number}[]} level is depth % 3, or -1 for a stray closer
 */
export function scanBrackets(text, offset = 0, stack = [], skip = null, emitFrom = 0) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const o = OPEN.indexOf(ch);
    const c = o < 0 ? CLOSE.indexOf(ch) : -1;
    if (o < 0 && c < 0) continue;
    const pos = offset + i;
    if (skip && skip(pos)) continue;
    if (o >= 0) {
      if (pos >= emitFrom) out.push({ pos, level: stack.length % DEPTH_COLORS });
      stack.push(o);
    } else if (stack.length && stack[stack.length - 1] === c) {
      stack.pop();
      if (pos >= emitFrom) out.push({ pos, level: stack.length % DEPTH_COLORS });
    } else if (pos >= emitFrom) {
      out.push({ pos, level: -1 });
    }
  }
  return out;
}

/** Brackets with their level in [from, to), using the syntax tree. */
function treeBrackets(state, from, to) {
  const out = [];
  const stack = [];
  const doc = state.doc;
  syntaxTree(state).iterate({
    from: 0, to,
    enter: (n) => {
      if (n.to - n.from === 1) {
        const ch = doc.sliceString(n.from, n.to);
        const o = OPEN.indexOf(ch);
        // the prop names the partner: a ")" for "(", but "InterpolationEnd" for a template's "}"
        if (o >= 0 && pairs(n.type.prop(NodeProp.closedBy), CLOSE[o])) {
          if (n.from >= from) out.push({ pos: n.from, level: stack.length % DEPTH_COLORS });
          stack.push(o);
          return false;
        }
        const c = CLOSE.indexOf(ch);
        if (c >= 0 && pairs(n.type.prop(NodeProp.openedBy), OPEN[c])) {
          if (stack.length && stack[stack.length - 1] === c) {
            stack.pop();
            if (n.from >= from) out.push({ pos: n.from, level: stack.length % DEPTH_COLORS });
          } else if (n.from >= from) {
            out.push({ pos: n.from, level: -1 });
          }
          return false;
        }
      }
      // Above the screen: a finished subtree has matched pairs, skip it.
      if (n.to <= from && n.from < n.to) return false;
      return undefined;
    },
  });
  return out.filter((b) => b.pos < to);
}

const pairs = (names, ch) => !!names && names.includes(ch);

const NOT_CODE = /string|comment|regexp|meta/i;

/**
 * The text scan needs the openers left unclosed above the screen. Finding
 * them means scanning (up to SCAN_LIMIT) from far above, which is slow in a
 * big file, so it is kept in `memo` ({start, from, stack, treeLen}) and reused
 * while nothing above the screen changes — typing on screen costs only the
 * screen.
 */
export function textBrackets(state, from, to, memo = null) {
  const start = Math.max(0, from - SCAN_LIMIT);
  const tree = syntaxTree(state);
  const skip = state.facet(language) ? (pos) => NOT_CODE.test(tree.resolveInner(pos, 1).name) : null;
  // Reusable if it was computed with the text above the screen fully parsed,
  // or the parse hasn't got further since (it would find the same).
  let above = memo && memo.from === from && memo.start === start && (memo.treeLen >= from || tree.length <= memo.treeLen) ? memo : null;
  if (!above) {
    const stack = [];
    scanBrackets(state.doc.sliceString(start, from), start, stack, skip, from);
    above = { start, from, stack, treeLen: tree.length };
  }
  const levels = scanBrackets(state.doc.sliceString(from, to), from, above.stack.slice(), skip, from);
  return { levels, memo: above };
}

const usesTree = (state) => {
  const lang = state.facet(language);
  return !!lang && !(lang instanceof StreamLanguage);
};

/** Brackets with a colour level in [from, to) for any document. */
export function bracketLevels(state, from, to) {
  return usesTree(state) ? treeBrackets(state, from, to) : textBrackets(state, from, to).levels;
}

const WORDY = /^[\w$]*$/;
const RECOUNT_AFTER = 150; // ms after the last letter typed
const recount = StateEffect.define();

/**
 * Typing letters and digits moves the brackets but doesn't change how they
 * nest (nearly always: a letter can turn `retur /(/` into a regex), so those
 * keystrokes only shift the marks, and a full count follows a moment after
 * typing stops. Keeps a keystroke in a big file cheap.
 */
function wordsOnly(u) {
  let ok = true;
  u.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (ok && (!WORDY.test(inserted.toString()) || !WORDY.test(u.startState.sliceDoc(fromA, toA)))) ok = false;
  });
  return ok;
}

const marks = [0, 1, 2].map((i) => Decoration.mark({ class: `cm-bp cm-bp${i}` }));
const bad = Decoration.mark({ class: 'cm-bp cm-bp-bad' });

function bracketDecorations(view, plugin) {
  const { from, to } = view.viewport;
  let levels;
  if (usesTree(view.state)) {
    levels = treeBrackets(view.state, from, to);
    plugin.memo = null;
  } else {
    ({ levels, memo: plugin.memo } = textBrackets(view.state, from, to, plugin.memo));
  }
  const builder = new RangeSetBuilder();
  const visible = view.visibleRanges;
  let r = 0;
  for (const { pos, level } of levels) {
    while (r < visible.length && visible[r].to <= pos) r++;
    if (r === visible.length) break;
    if (pos < visible[r].from) continue; // folded away
    builder.add(pos, pos + 1, level < 0 ? bad : marks[level]);
  }
  return builder.finish();
}

export const bracketColors = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.memo = null;
    this.timer = 0;
    this.decorations = bracketDecorations(view, this);
  }

  later() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.view.composing) this.later();
      else this.view.dispatch({ effects: recount.of(null) });
    }, RECOUNT_AFTER);
  }

  destroy() { clearTimeout(this.timer); }

  update(u) {
    if (u.docChanged && this.memo) {
      // An edit above the screen changes what is open there: scan again.
      const m = this.memo;
      if (u.changes.touchesRange(m.start, m.from)) this.memo = null;
      else this.memo = { ...m, start: u.changes.mapPos(m.start), from: u.changes.mapPos(m.from, -1) };
    }
    // While the keyboard composes a word, only move the marks along: new
    // elements around the composed text can make it lose its place.
    if (u.view.composing || (u.docChanged && !u.viewportChanged && wordsOnly(u))) {
      if (u.docChanged) { this.decorations = this.decorations.map(u.changes); this.later(); }
      return;
    }
    const recounted = u.transactions.some((tr) => tr.effects.some((e) => e.is(recount)));
    if (recounted || u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      clearTimeout(this.timer);
      this.decorations = bracketDecorations(u.view, this);
    }
  }
}, { decorations: (p) => p.decorations });

// ---- indent guides -------------------------------------------------------------

const blank = (text) => !/\S/.test(text);

/**
 * Pure: how many guides each line gets. `lines` are line texts; `step` the
 * indent unit in columns. Guides sit at columns 0, step, 2·step… left of the
 * text. A blank line follows VS Code: between two lines of the same indent it
 * takes theirs; at the start or end of a block, one level more than the
 * shallower side.
 * @param {(i:number)=>string|null} lineAt  0-based; null past the ends
 */
export function guideCounts(lineAt, first, last, step, tabSize = 4, lookaround = 200) {
  const cols = (text) => countColumn(/^[ \t]*/.exec(text)[0], tabSize);
  const levels = (c) => Math.ceil(c / step);
  const near = (i, dir) => {
    for (let k = 1; k <= lookaround; k++) {
      const t = lineAt(i + dir * k);
      if (t == null) return -1;
      if (!blank(t)) return levels(cols(t));
    }
    return -1;
  };
  const out = [];
  for (let i = first; i <= last; i++) {
    const t = lineAt(i);
    if (!blank(t)) { out.push(levels(cols(t))); continue; }
    const above = near(i, -1);
    const below = near(i, 1);
    if (above < 0 || below < 0) out.push(0);
    else if (above < below) out.push(above + 1);
    else if (above === below) out.push(below);
    else out.push(below + 1);
  }
  return out;
}

function guideDecorations(view) {
  const { state } = view;
  const step = Math.max(1, getIndentUnit(state)); // in columns
  const builder = new RangeSetBuilder();
  const lineAt = (i) => (i >= 0 && i < state.doc.lines ? state.doc.line(i + 1).text : null);
  for (const { from, to } of view.visibleRanges) {
    const first = state.doc.lineAt(from).number - 1;
    const last = state.doc.lineAt(to).number - 1;
    const counts = guideCounts(lineAt, first, last, step, state.tabSize);
    counts.forEach((n, k) => {
      if (n > 0) {
        const line = state.doc.line(first + k + 1);
        builder.add(line.from, line.from, Decoration.line({ class: 'cm-ig', attributes: { style: `--ig-n:${n};--ig-step:${step}ch` } }));
      }
    });
  }
  return builder.finish();
}

const lead = (text) => /^[ \t]*/.exec(text)[0];

/** No line break added or removed, and every edited line keeps its indentation and (non-)blankness. */
function indentKept(u) {
  let ok = true;
  u.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (!ok) return;
    const a = u.startState.doc.lineAt(fromA);
    if (inserted.lines > 1 || toA > a.to) { ok = false; return; }
    const b = u.state.doc.lineAt(fromB);
    if (lead(a.text) !== lead(b.text) || blank(a.text) !== blank(b.text)) ok = false;
  });
  return ok;
}

export const indentGuides = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = guideDecorations(view); }
  update(u) {
    const settingsChanged = u.startState.tabSize !== u.state.tabSize || getIndentUnit(u.startState) !== getIndentUnit(u.state);
    if (u.docChanged && !u.viewportChanged && !settingsChanged && indentKept(u)) {
      this.decorations = this.decorations.map(u.changes); // the guides can't have changed
    } else if (u.docChanged || u.viewportChanged || settingsChanged) {
      this.decorations = guideDecorations(u.view);
    }
  }
}, { decorations: (p) => p.decorations });
