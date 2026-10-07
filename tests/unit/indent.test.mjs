import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIndent } from '../../src/core/indent.js';

test('detects 2 and 4 spaces, tabs, and nothing', () => {
  assert.deepEqual(detectIndent('a {\n  b {\n    c;\n  }\n}\n'), { insertSpaces: true, size: 2 });
  assert.deepEqual(detectIndent('def f():\n    if x:\n        y\n    return 1\n'), { insertSpaces: true, size: 4 });
  assert.deepEqual(detectIndent('all:\n\tcc main.c\n\techo ok\n'), { insertSpaces: false, size: null });
  assert.equal(detectIndent('no\nindent\n'), null);
  assert.deepEqual(detectIndent('/**\n * doc\n * more\n */\nfunction f() {\n    return 1;\n}\n'), { insertSpaces: true, size: 4 });
});
