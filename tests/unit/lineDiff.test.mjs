import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, applyHunks, gutterMarkers, splitLines, unifiedRows } from '../../src/core/lineDiff.js';

test('identical texts have no hunks', () => {
  assert.deepEqual(diffLines(['a', 'b'], ['a', 'b']), []);
});

test('insert / delete / modify hunks', () => {
  assert.deepEqual(diffLines(['a', 'c'], ['a', 'b', 'c']), [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1 }]);
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'c']), [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 0 }]);
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'X', 'c']), [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }]);
});

test('gutter markers', () => {
  const old = 'one\ntwo\nthree\nfour\n';
  assert.deepEqual(gutterMarkers(old, 'one\ntwo\nNEW\nthree\nfour\n'), [{ line: 2, kind: 'added' }]);
  assert.deepEqual(gutterMarkers(old, 'one\nTWO\nthree\nfour\n'), [{ line: 1, kind: 'modified' }]);
  assert.deepEqual(gutterMarkers(old, 'one\nthree\nfour\n'), [{ line: 0, kind: 'deleted' }]);
  assert.deepEqual(gutterMarkers('', 'a\nb'), [{ line: 0, kind: 'added' }, { line: 1, kind: 'added' }]);
});

test('unified rows', () => {
  const rows = unifiedRows('a\nb\nc\n', 'a\nB\nc\n');
  assert.deepEqual(rows.map((r) => r.kind), ['hunk', 'context', 'del', 'add', 'context']);
  assert.equal(rows[0].text, '@@ -1,3 +1,3 @@');
});

// Spec §8: randomized test — thousands of random edits; applying the diff must
// always reproduce the target exactly.
test('randomized: applying hunks reproduces the new text', () => {
  let seed = 12345;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const vocab = ['x', 'y', 'z', '{', '}', 'return 1;', '', 'foo()'];
  for (let iter = 0; iter < 1500; iter++) {
    const a = Array.from({ length: rand(30) }, () => vocab[rand(vocab.length)]);
    const b = a.slice();
    const edits = rand(6);
    for (let e = 0; e < edits; e++) {
      const op = rand(3);
      const at = rand(b.length + 1);
      if (op === 0) b.splice(at, 0, vocab[rand(vocab.length)]);
      else if (op === 1 && b.length) b.splice(Math.min(at, b.length - 1), 1);
      else if (b.length) b[Math.min(at, b.length - 1)] = vocab[rand(vocab.length)];
    }
    const hunks = diffLines(a, b);
    assert.deepEqual(applyHunks(a, b, hunks), b, `iteration ${iter}`);
    // hunks are sorted and non-overlapping
    for (let i = 1; i < hunks.length; i++) assert.ok(hunks[i].oldStart >= hunks[i - 1].oldStart + hunks[i - 1].oldLines);
  }
});

test('splitLines ignores the trailing newline', () => {
  assert.deepEqual(splitLines('a\r\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines(''), []);
});

test('large, completely different files still finish quickly', () => {
  const a = Array.from({ length: 6000 }, (_, i) => `old ${i}`);
  const b = Array.from({ length: 6000 }, (_, i) => `new ${i}`);
  const t = Date.now();
  const hunks = diffLines(a, b);
  assert.ok(Date.now() - t < 3000);
  assert.deepEqual(applyHunks(a, b, hunks), b);
});
