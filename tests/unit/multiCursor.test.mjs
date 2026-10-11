// Typing reaches every cursor (editor/multiCursor.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { mirrorToRanges } from '../../src/editor/multiCursor.js';

const LOOP = 'for (let index = 0; index < bound; index++) {}';

/** A state with every occurrence of `word` selected (the first is the main one). */
function selectAll(doc, word, { cursorsAtEnd = false } = {}) {
  const ranges = [];
  for (let i = doc.indexOf(word); i >= 0; i = doc.indexOf(word, i + 1)) {
    ranges.push(cursorsAtEnd ? EditorSelection.cursor(i + word.length) : EditorSelection.range(i, i + word.length));
  }
  return EditorState.create({ doc, selection: EditorSelection.create(ranges, 0), extensions: [EditorState.allowMultipleSelections.of(true)] });
}

/** What CodeMirror dispatches when it skips the other cursors: a change at the main range only. */
function mainOnly(state, change, mainSel) {
  const changes = state.changes(change);
  const ranges = state.selection.ranges.map((r, i) => (i === state.selection.mainIndex ? mainSel : r.map(changes)));
  return state.update({ changes, selection: EditorSelection.create(ranges, state.selection.mainIndex), userEvent: 'input.type.compose' });
}

const apply = (state, spec) => state.update(spec).state;
const heads = (state) => state.selection.ranges.map((r) => r.head);

test('a letter typed over the for-loop fields reaches all three', () => {
  const s = selectAll(LOOP, 'index');
  const f = s.selection.main.from;
  const next = apply(s, mirrorToRanges(s, mainOnly(s, { from: f, to: f + 5, insert: 'i' }, EditorSelection.cursor(f + 1))));
  assert.equal(next.doc.toString(), 'for (let i = 0; i < bound; i++) {}');
  assert.deepEqual(heads(next), [10, 17, 28], 'each cursor after its "i"');
  assert.equal(next.selection.mainIndex, 0);
});

test('then the composition grows the word ("i" → "id" → "idx") everywhere', () => {
  let s = EditorState.create({ doc: 'for (let i = 0; i < bound; i++) {}', selection: EditorSelection.create([10, 17, 28].map((p) => EditorSelection.cursor(p)), 0), extensions: [EditorState.allowMultipleSelections.of(true)] });
  for (const [from, word] of [[9, 'id'], [9, 'idx']]) {
    const head = s.selection.main.head;
    s = apply(s, mirrorToRanges(s, mainOnly(s, { from, to: head, insert: word }, EditorSelection.cursor(from + word.length))));
  }
  assert.equal(s.doc.toString(), 'for (let idx = 0; idx < bound; idx++) {}');
  assert.deepEqual(heads(s), [12, 21, 34]);
});

test('Ctrl+D selections on several lines; deleting them', () => {
  const s = selectAll('let total = 1;\ntotal += 2;\nlog(total);', 'total');
  const f = s.selection.main.from;
  const next = apply(s, mirrorToRanges(s, mainOnly(s, { from: f, to: f + 5, insert: '' }, EditorSelection.cursor(f))));
  assert.equal(next.doc.toString(), 'let  = 1;\n += 2;\nlog();');
});

test('nothing to add when CodeMirror already changed every cursor; only the missing ones otherwise', () => {
  const s = selectAll(LOOP, 'index');
  const [a, b, c] = s.selection.ranges.map((r) => r.from);
  const all = s.update({ changes: [a, b, c].map((p) => ({ from: p, to: p + 5, insert: 'n' })), userEvent: 'input.type' });
  assert.equal(mirrorToRanges(s, all), null);
  const two = s.update({ changes: [a, b].map((p) => ({ from: p, to: p + 5, insert: 'n' })), userEvent: 'input.type' });
  assert.equal(apply(s, mirrorToRanges(s, two)).doc.toString(), 'for (let n = 0; n < bound; n++) {}');
});

test('cursors with different text, a veto, or a single cursor: left alone', () => {
  const s = EditorState.create({ doc: 'abc xyz', selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)], 0), extensions: [EditorState.allowMultipleSelections.of(true)] });
  assert.equal(mirrorToRanges(s, mainOnly(s, { from: 0, to: 3, insert: 'Q' }, EditorSelection.cursor(1))), null, 'xyz is not abc');
  const loop = selectAll(LOOP, 'index');
  const f = loop.selection.main.from;
  const tr = mainOnly(loop, { from: f, to: f + 5, insert: 'i' }, EditorSelection.cursor(f + 1));
  const vetoed = apply(loop, mirrorToRanges(loop, tr, (r) => r.from !== 20));
  assert.equal(vetoed.doc.toString(), 'for (let i = 0; index < bound; i++) {}', 'the vetoed one keeps its text');
  const one = EditorState.create({ doc: 'index' });
  assert.equal(mirrorToRanges(one, one.update({ changes: { from: 0, insert: 'x' } })), null);
});
