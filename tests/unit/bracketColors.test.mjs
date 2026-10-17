// Coloured bracket pairs and indent guides (editor/bracketColors.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { scanBrackets, bracketLevels, guideCounts, textBrackets } from '../../src/editor/bracketColors.js';

/** "ch:level" for every coloured bracket; level -1 = stray closer. */
function levels(doc, lang, from = 0, to = doc.length) {
  const state = EditorState.create({ doc, extensions: lang ? [lang] : [] });
  if (lang) ensureSyntaxTree(state, doc.length, 5000);
  return bracketLevels(state, from, to).map(({ pos, level }) => `${doc[pos]}${level}`).join(' ');
}

test('scan: nesting levels cycle through three colours, pairs share a colour', () => {
  const r = scanBrackets('f(a[b{c(d)}])');
  assert.deepEqual(r.map((b) => b.level), [0, 1, 2, 0, 0, 2, 1, 0]);
});

test('scan: a closer with nothing to close, or the wrong kind, is marked -1', () => {
  assert.deepEqual(scanBrackets(')').map((b) => b.level), [-1]);
  // "]" does not close "(": stray; the ")" still closes it
  assert.deepEqual(scanBrackets('(])').map((b) => b.level), [0, -1, 0]);
});

test('scan: the stack carries over, and positions before emitFrom are not returned', () => {
  const stack = [];
  scanBrackets('{ (', 0, stack);
  assert.equal(stack.length, 2);
  const r = scanBrackets('xx ) }', 10, stack, null, 13);
  assert.deepEqual(r, [{ pos: 13, level: 1 }, { pos: 15, level: 0 }]);
});

test('JS: brackets in strings, comments, regexes and templates do not count', () => {
  const src = 'f(") ]", /\\(/, `(${a[0]}`); // (\n{ }';
  assert.equal(levels(src, javascript()), '(0 [1 ]1 )0 {0 }0');
});

test('JS: only the screen part is returned, with the depth from above it', () => {
  const src = 'function a() {\n  if (x) {\n    y([1, 2]);\n  }\n}\n';
  const from = src.indexOf('y(');
  const to = src.indexOf('}');
  assert.equal(levels(src, javascript(), from, to), '(2 [0 ]0 )2');
});

test('JS: a stray closer is marked', () => {
  assert.equal(levels('a());', javascript()), '(0 )0 )-1');
});

test('Python, CSS and the script inside HTML', () => {
  assert.equal(levels('x = [f(1), {"a": (2)}]  # (', python()), '[0 (1 )1 {1 (2 )2 }1 ]0');
  assert.equal(levels('a { color: rgb(1, 2, 3); }', css()), '{0 (1 )1 }0');
  assert.equal(levels('<p>(</p><script>f([1])</script>', html()), '(0 [1 ]1 )0');
});

test('simple-mode languages and plain text: text scan, strings and comments skipped', async () => {
  const { rust } = await import('@codemirror/legacy-modes/mode/rust');
  assert.equal(levels('fn m() { let s = "("; } // )', StreamLanguage.define(rust)), '(0 )0 {0 }0');
  assert.equal(levels('a (b [c] d)', null), '(0 [1 ]1 )0');
});

test('simple modes: what is open above the screen is remembered, and still right after typing on screen', async () => {
  const { go } = await import('@codemirror/legacy-modes/mode/go');
  const lang = StreamLanguage.define(go);
  const above = 'func a() {\n  if x {\n    s := "{"\n';
  const doc = above + '    f(g[1])\n  }\n}\n';
  let state = EditorState.create({ doc, extensions: [lang] });
  ensureSyntaxTree(state, doc.length, 5000);
  const from = above.length;
  const first = textBrackets(state, from, doc.length);
  const show = (r, d) => r.levels.map(({ pos, level }) => `${d[pos]}${level}`).join(' ');
  assert.equal(show(first, doc), '(2 [0 ]0 )2 }1 }0');
  // type "(" on screen: the memo from before is reused, the result matches a fresh scan
  state = state.update({ changes: { from: from + 4, insert: '(' } }).state;
  ensureSyntaxTree(state, state.doc.length, 5000);
  const d2 = state.doc.toString();
  const reused = textBrackets(state, from, d2.length, first.memo);
  assert.equal(reused.memo, first.memo);
  assert.equal(show(reused, d2), show(textBrackets(state, from, d2.length), d2));
  // the new "(" is never closed: the pair after it goes a level deeper, and the "}"s no longer match
  assert.equal(show(reused, d2), '(2 (0 [1 ]1 )0 }-1 }-1');
});

test('indent guides: one per indentation level left of the text', () => {
  const lines = ['a {', '    b {', '        c', '      d', '    }', '}'];
  const at = (i) => lines[i] ?? null;
  assert.deepEqual(guideCounts(at, 0, 5, 4), [0, 1, 2, 2, 1, 0]); // "      d": guides at 0 and 4
  const tabs = ['x', '\ty', '\t\tz'];
  assert.deepEqual(guideCounts((i) => tabs[i] ?? null, 0, 2, 4, 4), [0, 1, 2]);
});

test('indent guides: blank lines continue the guides around them (VS Code rule)', () => {
  const lines = ['if (a) {', '', '    b();', '', '    c();', '', '}', ''];
  const at = (i) => lines[i] ?? null;
  // start of a block: one level more than above; between same indents: theirs;
  // end of a block: one more than below; at the end of the file: none
  assert.deepEqual(guideCounts(at, 0, 7, 4), [0, 1, 1, 1, 1, 1, 0, 0]);
});
