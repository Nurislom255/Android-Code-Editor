// The other uses of the name under the cursor (editor/wordHighlight.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { ensureSyntaxTree, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { nameUses } from '../../src/editor/wordHighlight.js';

/** "|" marks the cursor; returns the highlighted texts with their offsets. */
function uses(src, lang) {
  const at = src.indexOf('|');
  const doc = src.replace('|', '');
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(at), extensions: lang ? [lang] : [] });
  if (lang) ensureSyntaxTree(state, doc.length, 5000);
  return nameUses(state).map(([a, b]) => `${doc.slice(a, b)}@${a}`);
}

test('JS: every use of the variable, not the word in strings or comments', () => {
  const src = 'let total = 0;\nfor (const x of xs) tot|al += x; // total\nconsole.log("total", total);';
  assert.deepEqual(uses(src, javascript()), ['total@4', 'total@35', 'total@77']);
});

test('the cursor just after or just before the name counts; keywords and spaces do not', () => {
  assert.equal(uses('let a = 1; a|++', javascript()).length, 2);
  assert.equal(uses('let a = 1; |a++', javascript()).length, 2);
  assert.deepEqual(uses('l|et a = 1; let b', javascript()), []);
  assert.deepEqual(uses('let a = 1;  |  a', javascript()), []);
});

test('C++ and Python names; a property with the same name is a use too', () => {
  assert.equal(uses('int main() { int n = 0; n = n + 1; std::cout << |n; }', cpp()).length, 4);
  assert.equal(uses('class A:\n    def f(self, total):\n        self.total = tot|al', python()).length, 3);
});

test('legacy modes (Rust, Go…) and plain text', async () => {
  const { rust } = await import('@codemirror/legacy-modes/mode/rust');
  assert.equal(uses('fn main() { let total = 1; let y = tot|al + 1; }', StreamLanguage.define(rust)).length, 2);
  // no language: whole words only
  assert.deepEqual(uses('cat catalog |cat cat_x cat'), ['cat@0', 'cat@12', 'cat@22']);
});

test('nothing with a selection', () => {
  const state = EditorState.create({ doc: 'let a = a', selection: EditorSelection.range(4, 5), extensions: [javascript()] });
  assert.deepEqual(nameUses(state), []);
});
