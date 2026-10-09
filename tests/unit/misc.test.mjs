import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRef, resolveUrlRef, normalize, relative, extname, validateName } from '../../src/core/paths.js';
import { fuzzyMatch, fuzzyFilter } from '../../src/core/fuzzy.js';
import { buildMatcher, findInText } from '../../src/core/search.js';
import { parseLayout, parseToken, groupForLanguage, DEFAULT_LAYOUTS } from '../../src/core/keysLayout.js';
import { NavHistory } from '../../src/core/navHistory.js';
import { normalizeSettings, DEFAULTS } from '../../src/core/settings.js';
import { linkify } from '../../src/core/linkify.js';
import { inspect, formatLogArgs } from '../../src/core/inspect.js';
import { IgnoreRules } from '../../src/core/ignore.js';

test('paths', () => {
  assert.equal(resolveRef('site', 'css/a.css'), 'site/css/a.css');
  assert.equal(resolveRef('site/pages', '../img/x.png?v=2#top'), 'site/img/x.png');
  assert.equal(resolveRef('site/pages', '/root.js'), 'root.js');
  assert.equal(resolveRef('', './a%20b.js'), 'a b.js');
  assert.equal(resolveRef('', 'https://cdn.example/x.js'), null);
  assert.equal(resolveRef('', '//cdn.example/x.js'), null);
  assert.equal(resolveRef('', 'data:image/png;base64,xx'), null);
  assert.equal(resolveRef('', '#anchor'), null);
  assert.equal(resolveRef('', '../outside.js'), null);
  assert.equal(normalize('a/./b/../c'), 'a/c');
  assert.equal(relative('a/b', 'a/c/d.js'), '../c/d.js');
  assert.equal(extname('x/Y.TS'), '.ts');
  assert.equal(extname('.gitignore'), '');
  assert.ok(validateName('a/b'));
  assert.equal(validateName('ok.js'), null);
  assert.equal(resolveUrlRef('', '../data.json'), 'data.json', 'like a browser: .. stops at the root');
  assert.equal(resolveUrlRef('a/b', '../c.js?x=1#h'), 'a/c.js');
  assert.equal(resolveUrlRef('a', '/root.css'), 'root.css');
  assert.equal(resolveUrlRef('', 'https://x.y/z.js'), null);
  assert.equal(resolveUrlRef('', 'my%20file.js'), 'my file.js');
});

test('fuzzy: in-order letters match, word starts and file names rank higher', () => {
  assert.equal(fuzzyMatch('xyz', 'src/app.js'), null);
  assert.ok(fuzzyMatch('apjs', 'src/app.js'));
  const ranked = fuzzyFilter('app', ['lib/mapper.js', 'src/app.js', 'apps/zzz/index.js']).map((r) => r.item);
  assert.equal(ranked[0], 'src/app.js');
  const m = fuzzyMatch('mc', 'src/myComponent.tsx');
  assert.deepEqual(m.positions.map((p) => 'src/myComponent.tsx'[p]), ['m', 'C']);
});

test('search: plain, case, whole word, regex, errors', () => {
  const text = 'let foo = 1;\nconst food = foo + Foo;\n';
  assert.equal(findInText(text, buildMatcher('foo')).length, 4);
  assert.equal(findInText(text, buildMatcher('foo', { caseSensitive: true })).length, 3);
  assert.equal(findInText(text, buildMatcher('foo', { wholeWord: true })).length, 3);
  const r = findInText(text, buildMatcher('f\\w+d', { regex: true }));
  assert.deepEqual(r.map((x) => [x.line, x.col]), [[2, 6]]);
  assert.throws(() => buildMatcher('(', { regex: true }), /Invalid regular expression/);
  assert.equal(findInText('abc', buildMatcher('^', { regex: true })).length, 0, 'zero-length matches do not hang');
  assert.equal(findInText(text, buildMatcher('food'))[0].preview, 'const food = foo + Foo;');
});

test('keys layout tokens with swipe-up alternates', () => {
  assert.deepEqual(parseToken('(^)'), { label: '(', insert: '(', alt: ')' });
  assert.deepEqual(parseToken('^'), { label: '^', insert: '^', alt: null });
  assert.deepEqual(parseToken('|^^'), { label: '|', insert: '|', alt: '^' });
  assert.deepEqual(parseToken('=^=>'), { label: '=', insert: '=', alt: '=>' });
  for (const layout of Object.values(DEFAULT_LAYOUTS)) assert.ok(parseLayout(layout).length >= 6);
  assert.equal(groupForLanguage('typescript'), 'js');
  assert.equal(groupForLanguage('nope'), 'plain');
});

test('nav history: back/forward and near-line coalescing', () => {
  const h = new NavHistory({ nearLines: 5 });
  h.push({ path: 'a.js', line: 1 });
  h.push({ path: 'a.js', line: 3 }); // near → replaces
  h.push({ path: 'b.js', line: 10 });
  h.push({ path: 'a.js', line: 100 });
  assert.equal(h.stack.length, 3);
  assert.deepEqual(h.back(), { path: 'b.js', line: 10 });
  assert.deepEqual(h.back(), { path: 'a.js', line: 3 });
  assert.equal(h.back(), null);
  assert.deepEqual(h.forward(), { path: 'b.js', line: 10 });
  h.push({ path: 'c.js', line: 1 }); // drops forward branch
  assert.equal(h.canForward(), false);
  h.removePath('b.js');
  assert.deepEqual(h.stack.map((e) => e.path), ['a.js', 'c.js']);
});

test('settings: v1 data migrates, garbage is clamped', () => {
  const v1 = { theme: 'light', fontSize: 16, tabWidth: 4, panelHeight: 300, keysBarMode: 'always' };
  const s = normalizeSettings(v1);
  assert.equal(s.theme, 'light');
  assert.equal(s.fontSize, 16);
  assert.equal(s.keysBarMode, 'always');
  assert.equal(s.version, 2);
  assert.equal(s.gestureMap['swipe-right-1'], 'autocomplete');
  const bad = normalizeSettings({ fontSize: 9999, theme: 'neon', gestureMap: { 'swipe-right-1': 'rm -rf' } });
  assert.equal(bad.fontSize, 40);
  assert.equal(bad.theme, DEFAULTS.theme);
  assert.equal(bad.gestureMap['swipe-right-1'], 'autocomplete');
  assert.deepEqual(normalizeSettings(null), normalizeSettings({}));
});

test('linkify stack traces', () => {
  const parts = linkify('TypeError: x\n    at f (src/app.js:12:5)\n    at http://localhost:8080/a.js:1:1');
  const links = parts.filter((p) => p.path);
  assert.equal(links.length, 1);
  assert.deepEqual({ ...links[0] }, { text: 'src/app.js:12:5', path: 'src/app.js', line: 12, col: 5 });
  assert.equal(parts.map((p) => p.text).join(''), 'TypeError: x\n    at f (src/app.js:12:5)\n    at http://localhost:8080/a.js:1:1');
  assert.equal(linkify('see main.py:3', (p) => (p === 'main.py' ? 'tools/main.py' : null)).find((p) => p.path).path, 'tools/main.py');
  assert.equal(linkify('ratio 3:4 at 10:30').filter((p) => p.path).length, 0);
});

test('inspect values like a console', () => {
  assert.equal(inspect('hi'), 'hi');
  assert.equal(inspect(['a', 1, null, undefined]), "[ 'a', 1, null, undefined ]");
  assert.equal(inspect({ a: 1, 'b-c': [1, 2] }), "{ a: 1, 'b-c': [ 1, 2 ] }");
  assert.equal(inspect(new Map([['k', 1]])), "Map(1) { 'k' => 1 }");
  assert.equal(inspect(new Set([1])), 'Set(1) { 1 }');
  const circ = { name: 'x' }; circ.self = circ;
  assert.equal(inspect(circ), "{ name: 'x', self: [Circular] }");
  assert.equal(inspect({ a: { b: { c: { d: 1 } } } }), '{ a: { b: { c: [Object] } } }');
  assert.equal(inspect(function foo() {}), '[Function: foo]');
  assert.equal(inspect(class Bar {}), '[class Bar]');
  assert.equal(inspect(10n), '10n');
  assert.match(inspect(new Error('boom')), /^Error: boom/);
  assert.equal(formatLogArgs(['%s is %d', 'Ann', 30, 'extra']), 'Ann is 30 extra');
  assert.equal(formatLogArgs(['a', { x: 1 }]), 'a { x: 1 }');
  assert.equal(formatLogArgs(['100%%']), '100%');
});

test('ignore rules: names + nested .gitignore', () => {
  let rules = new IgnoreRules(['node_modules', '.git']);
  assert.ok(rules.isIgnored('node_modules/x/index.js'));
  assert.ok(rules.isIgnored('a/.git', true));
  rules = rules.withGitignore('', '*.log\ndist/\n!keep.log\n');
  rules = rules.withGitignore('web', '/secret.txt\n');
  assert.ok(rules.isIgnored('debug.log'));
  assert.ok(!rules.isIgnored('keep.log'));
  assert.ok(rules.isIgnored('dist', true));
  assert.ok(rules.isIgnored('web/secret.txt'));
  assert.ok(!rules.isIgnored('secret.txt'), 'nested .gitignore only applies below its folder');
  assert.ok(!rules.isIgnored('web/sub/secret.txt'), 'leading slash anchors to that folder');
});

test('keys bar: which drags on a symbol key are a swipe up', async () => {
  const { classifyKeyDrag } = await import('../../src/core/keysLayout.js');
  assert.equal(classifyKeyDrag(2, 3), 'none', 'a small wobble is still a tap');
  assert.equal(classifyKeyDrag(0, 30), 'up');
  assert.equal(classifyKeyDrag(20, 30), 'up', 'leaning ~34°');
  assert.equal(classifyKeyDrag(-28, 20), 'up', 'leaning ~54° to the left');
  assert.equal(classifyKeyDrag(40, 12), 'pan', 'mostly sideways scrolls the row');
  assert.equal(classifyKeyDrag(-30, 0), 'pan');
  assert.equal(classifyKeyDrag(3, -20), 'none', 'downward: no alternate');
});
