import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEditorConfig, globMatches, resolveEditorConfig } from '../../src/core/editorconfig.js';

test('parse sections, root and comments', () => {
  const cfg = parseEditorConfig(`# top
root = true

[*]
indent_style = space
indent_size = 2
; comment
[*.py]
indent_size = 4
`);
  assert.equal(cfg.root, true);
  assert.equal(cfg.sections.length, 2);
  assert.deepEqual(cfg.sections[1], { glob: '*.py', props: { indent_size: '4' } });
});

test('glob rules', () => {
  assert.ok(globMatches('*', 'a.js'));
  assert.ok(globMatches('*', 'deep/dir/a.js'), 'no slash = matches basename anywhere');
  assert.ok(globMatches('*.js', 'src/a.js'));
  assert.ok(!globMatches('*.js', 'src/a.ts'));
  assert.ok(globMatches('*.{js,ts}', 'src/a.ts'));
  assert.ok(globMatches('src/*.js', 'src/a.js'));
  assert.ok(!globMatches('src/*.js', 'src/x/a.js'), '* does not cross folders');
  assert.ok(globMatches('src/**.js', 'src/x/a.js'));
  assert.ok(globMatches('/lib/**/*.c', 'lib/a/b/c.c'));
  assert.ok(globMatches('/lib/**/*.c', 'lib/c.c'), '**/ matches zero folders');
  assert.ok(globMatches('file?.txt', 'file1.txt'));
  assert.ok(globMatches('[ab].md', 'b.md'));
  assert.ok(!globMatches('[!ab].md', 'b.md'));
  assert.ok(globMatches('test{1..3}.js', 'test2.js'));
  assert.ok(!globMatches('test{1..3}.js', 'test7.js'));
  assert.ok(globMatches('Makefile', 'sub/Makefile'));
});

test('resolve: nearest file wins, root stops the search', () => {
  const configs = [
    { dir: '', text: 'root = true\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\n' },
    { dir: 'py', text: '[*.py]\nindent_size = 4\ntrim_trailing_whitespace = true\n' },
    { dir: 'legacy', text: 'root = true\n[*]\nindent_style = tab\ntab_width = 8\nend_of_line = crlf\ninsert_final_newline = false\n' },
  ];
  assert.deepEqual(resolveEditorConfig('py/app.py', configs), {
    indentStyle: 'space', indentSize: 4, tabWidth: 4, endOfLine: 'lf', trimTrailingWhitespace: true,
  });
  assert.deepEqual(resolveEditorConfig('legacy/x.c', configs), {
    indentStyle: 'tab', indentSize: 8, tabWidth: 8, endOfLine: 'crlf', insertFinalNewline: false,
  });
  assert.deepEqual(resolveEditorConfig('other.js', configs), {
    indentStyle: 'space', indentSize: 2, tabWidth: 2, endOfLine: 'lf',
  });
});

test('indent_size = tab uses tab_width; unset clears', () => {
  const r = resolveEditorConfig('a.go', [{ dir: '', text: '[*]\nindent_style=tab\nindent_size=tab\ntab_width=4\ncharset=unset\n' }]);
  assert.deepEqual(r, { indentStyle: 'tab', indentSize: 4, tabWidth: 4 });
});
