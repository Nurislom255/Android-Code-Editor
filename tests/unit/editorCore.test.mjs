// Editor logic that only needs an EditorState (no DOM): outline symbols,
// expand/shrink selection, syntax-error detection, snippets parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { cpp } from '@codemirror/lang-cpp';
import { getSymbols, flattenSymbols, symbolPathAt, stickySymbolsAt } from '../../src/editor/outline.js';
import { expandStack, expandSelection, shrinkSelection } from '../../src/editor/selection.js';
import { syntaxDiagnostics } from '../../src/editor/syntaxLint.js';
import { parseUserSnippets } from '../../src/editor/snippets.js';
import { minimalChange } from '../../src/app/workspace.js';

const mk = (doc, lang, sel) => EditorState.create({ doc, extensions: [lang, expandStack], selection: sel });

test('outline: JS functions, classes, methods, arrow consts, nesting', () => {
  const s = mk('function a() {}\nclass B {\n  m() {}\n  static n = () => 1\n}\nconst c = () => {\n  function inner() {}\n};\nlet notFn = 1;\n', javascript());
  const forest = getSymbols(s);
  assert.deepEqual(flattenSymbols(forest).map((x) => `${'  '.repeat(x.depth)}${x.kind}:${x.name}`), [
    'function:a', 'class:B', '  method:m', '  method:n', 'function:c', '  function:inner',
  ]);
  const path = symbolPathAt(forest, s.doc.line(3).from + 3).map((x) => x.name);
  assert.deepEqual(path, ['B', 'm']);
  assert.deepEqual(stickySymbolsAt(forest, 4, s.doc).map((x) => x.name), ['B']);
});

test('outline: Python, C++, CSS, Markdown headings', () => {
  const py = getSymbols(mk('class A:\n    def m(self):\n        pass\n\ndef f():\n    pass\n', python()));
  assert.deepEqual(flattenSymbols(py).map((x) => x.name), ['A', 'm', 'f']);
  const c = getSymbols(mk('int main() { return 0; }\nstruct S { int x; };\n', cpp()));
  assert.deepEqual(flattenSymbols(c).map((x) => x.name), ['main', 'S']);
  const cs = getSymbols(mk('a, .b { color: red }\n@media (max-width: 1px) { p { x: y } }\n', css()));
  assert.deepEqual(flattenSymbols(cs).map((x) => x.name), ['a, .b', '@media (max-width: 1px)', 'p']);
  const md = getSymbols(mk('# Top\ntext\n## Sub\nmore\n# Next\n', markdown()));
  assert.deepEqual(flattenSymbols(md).map((x) => `${x.depth}:${x.name}`), ['0:Top', '1:Sub', '0:Next']);
});

test('expand selection: word → inside brackets → brackets → … ; shrink goes back', () => {
  const doc = 'foo(bar, baz);';
  let state = mk(doc, javascript(), EditorSelection.single(5)); // inside "bar"
  const view = { get state() { return state; }, dispatch(spec) { state = state.update(spec).state; } };
  const sel = () => state.sliceDoc(state.selection.main.from, state.selection.main.to);
  expandSelection(view); assert.equal(sel(), 'bar');
  expandSelection(view); assert.equal(sel(), 'bar, baz');
  expandSelection(view); assert.equal(sel(), '(bar, baz)');
  expandSelection(view); assert.equal(sel(), 'foo(bar, baz)');
  shrinkSelection(view); assert.equal(sel(), '(bar, baz)');
  shrinkSelection(view); assert.equal(sel(), 'bar, baz');
});

test('syntax errors are found from the parse tree', () => {
  assert.equal(syntaxDiagnostics(mk('const a = 1;\nfunction f() { return a }\n', javascript())).length, 0);
  const bad = syntaxDiagnostics(mk('const a = ;\nfunction (\n', javascript()));
  assert.ok(bad.length >= 1);
  assert.equal(bad[0].severity, 'error');
  assert.match(bad[0].message, /Syntax error/);
  assert.ok(syntaxDiagnostics(mk('def f(:\n  pass\n', python())).length >= 1);
});

test('user snippets JSON', () => {
  assert.deepEqual(parseUserSnippets(''), { snippets: {}, error: null });
  const ok = parseUserSnippets('{"javascript":[{"label":"hi","body":"hello ${1:x}"}],"*":[{"label":"todo","body":"TODO: ${0}"}]}');
  assert.deepEqual(ok.snippets.javascript, [['hi', 'hello ${1:x}', 'user snippet']]);
  assert.match(parseUserSnippets('{oops').error, /invalid/);
});

test('minimalChange keeps unchanged prefix/suffix out of the edit', () => {
  assert.deepEqual(minimalChange('hello world', 'hello brave world'), { from: 6, to: 6, insert: 'brave ' });
  assert.deepEqual(minimalChange('abc', 'abc'), null);
  assert.deepEqual(minimalChange('aXc', 'aYYc'), { from: 1, to: 2, insert: 'YY' });
});
