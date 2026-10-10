// The keys bar's context row (core/contextKeys.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextKeys, lineContext, parseTextKey, keyLabel } from '../../src/core/contextKeys.js';

const sit = (over) => ({ group: 'plain', lang: 'plaintext', before: '', inString: null, inComment: false, inTag: false, inCssBlock: false, selection: false, template: false, ...over });

test('where the cursor is on the line', () => {
  assert.equal(lineContext('    ').statementStart, true);
  assert.equal(lineContext('  foo(); ').statementStart, true);
  assert.equal(lineContext('  int x = ').afterEquals, true);
  assert.equal(lineContext('  if (a == ').afterEquals, false);
  assert.equal(lineContext('  a <= ').afterEquals, false);
  assert.equal(lineContext('  total').afterName, true);
  assert.equal(lineContext('  foo()').afterName, true);
  assert.equal(lineContext('  return').afterName, false, 'a keyword is not a name');
  assert.equal(lineContext('  std::cout << "hi" ').cout, true);
  assert.equal(lineContext('  cout << x; y').cout, false, 'the statement ended');
});

test('C++ keys follow the statement', () => {
  const cpp = (before) => contextKeys(sit({ group: 'clike', lang: 'cpp', before }));
  assert.deepEqual(cpp('    ').slice(0, 2), ['std::', 'cout << ']);
  assert.ok(cpp('    std::cout ').includes('<< '));
  assert.ok(cpp('    std::cout << x ').includes('endl'));
  assert.deepEqual(cpp('    std::cin ')[0], '>> ');
  assert.ok(cpp('    int* p = ').includes('nullptr'));
  assert.deepEqual(cpp('    double y = ').slice(0, 4), ['{|}', '"|"', 'pow(|)', 'nullptr'], 'C++ has no power operator: pow() is offered');
  assert.ok(cpp('    obj').includes('->'));
  assert.ok(contextKeys(sit({ group: 'clike', lang: 'java', before: '    String s = ' })).includes('new '));
  assert.ok(contextKeys(sit({ group: 'clike', lang: 'c', before: '' }))[0].startsWith('printf'));
});

test('other languages, strings, comments and selections', () => {
  assert.ok(contextKeys(sit({ group: 'js', before: 'const f = ' })).includes('() => '));
  assert.ok(contextKeys(sit({ group: 'js', before: 'user' })).includes('?.'));
  assert.deepEqual(contextKeys(sit({ group: 'js', inString: '`', template: true }))[0], '${|}');
  assert.ok(contextKeys(sit({ group: 'js', inString: '"' })).includes('"'), 'the closing quote');
  assert.ok(contextKeys(sit({ group: 'python', before: '' })).includes('def '));
  assert.ok(contextKeys(sit({ group: 'html', inTag: true })).includes('class="|"'));
  assert.ok(contextKeys(sit({ group: 'css', inCssBlock: true })).includes('!important'));
  assert.deepEqual(contextKeys(sit({ group: 'js', inComment: true })), []);
  assert.deepEqual(contextKeys(sit({ group: 'js', selection: true })).slice(0, 3), ['@cut', '@copy', '@paste']);
});

test('text keys: cursor marker and label', () => {
  assert.deepEqual(parseTextKey('class="|"'), { text: 'class=""', cursor: 7 });
  assert.deepEqual(parseTextKey('const '), { text: 'const ', cursor: 6 });
  assert.deepEqual(parseTextKey('a \\|\\| |b'), { text: 'a || b', cursor: 5 });
  assert.equal(keyLabel(' = '), '=');
  assert.equal(keyLabel('print(|)'), 'print()');
  assert.equal(keyLabel('cout << '), 'cout <<');
});

test('situation at the cursor, from the syntax tree', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { ensureSyntaxTree } = await import('@codemirror/language');
  const { javascript } = await import('@codemirror/lang-javascript');
  const { html } = await import('@codemirror/lang-html');
  const { cpp } = await import('@codemirror/lang-cpp');
  const { situationAt } = await import('../../src/editor/keysContext.js');
  const at = (src, lang, ext) => {
    const pos = src.indexOf('|');
    const state = EditorState.create({ doc: src.replace('|', ''), selection: { anchor: pos }, extensions: [ext] });
    ensureSyntaxTree(state, state.doc.length, 5000);
    return situationAt(state, lang);
  };
  assert.equal(at('const s = "ab|c";', 'javascript', javascript()).inString, '"');
  assert.equal(at('const s = "abc"|;', 'javascript', javascript()).inString, null, 'after the closing quote');
  assert.equal(at('const s = "abc|', 'javascript', javascript()).inString, '"', 'an unclosed string');
  const t = at('const s = `a ${x} b|`;', 'javascript', javascript());
  assert.equal(t.inString, '`');
  assert.equal(t.template, true);
  assert.equal(at('x = 1; // note|', 'javascript', javascript()).inComment, true);
  assert.equal(at('<div class="a" |></div>', 'html', html()).inTag, true);
  assert.equal(at('<div>te|xt</div>', 'html', html()).inTag, false);
  const css = at('<style>\n p { col| }\n</style>', 'html', html());
  assert.equal(css.group, 'css');
  assert.equal(css.inCssBlock, true);
  assert.equal(at('<script>\n let a = |\n</script>', 'html', html()).group, 'js');
  const c = at('int main() {\n  std::cout << |\n}', 'cpp', cpp());
  assert.equal(c.group, 'clike');
  assert.equal(c.before, '  std::cout << ');
  assert.equal(at('int main() { printf("%d|"); }', 'cpp', cpp()).inString, '"');
});
