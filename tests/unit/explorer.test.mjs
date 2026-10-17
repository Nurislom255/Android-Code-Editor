// Pure explorer helpers (core/explorer.js): free names, selections, the filter, the trash's 7 days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeName, topLevel, canMoveInto, rangeBetween, filterPaths, expired, daysLeft, TRASH_DAYS } from '../../src/core/explorer.js';

const takenIn = (...paths) => (p) => paths.includes(p);

test('freeName: never overwrites — "name copy", then "name copy 2"…', () => {
  assert.equal(freeName('lib', 'a.js', takenIn()), 'a.js');
  assert.equal(freeName('lib', 'a.js', takenIn('lib/a.js')), 'a copy.js');
  assert.equal(freeName('lib', 'a.js', takenIn('lib/a.js', 'lib/a copy.js')), 'a copy 2.js');
  assert.equal(freeName('', 'Makefile', takenIn('Makefile')), 'Makefile copy');
  assert.equal(freeName('', '.env', takenIn('.env')), '.env copy'); // a leading dot is not an extension
  assert.equal(freeName('x', 'a.tar.gz', takenIn('x/a.tar.gz')), 'a.tar copy.gz');
});

test('topLevel: a selected folder covers what is inside it', () => {
  assert.deepEqual(topLevel(['src/a.js', 'src', 'lib/b.js', 'src/x/y.js', 'srcfile.js']), ['lib/b.js', 'src', 'srcfile.js']);
  assert.deepEqual(topLevel(['a', 'a']), ['a']);
});

test('canMoveInto: not into itself, not below itself, not where it already is', () => {
  assert.equal(canMoveInto('src', 'src'), false);
  assert.equal(canMoveInto('src', 'src/lib'), false);
  assert.equal(canMoveInto('src/a.js', 'src'), false);
  assert.equal(canMoveInto('src/a.js', ''), true);
  assert.equal(canMoveInto('src', 'srcx'), true); // a name that only starts the same
});

test('rangeBetween: Shift-click selects the rows in between, either direction', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(rangeBetween(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeBetween(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeBetween(order, 'gone', 'c'), ['c']);
  assert.deepEqual(rangeBetween(order, 'a', 'gone'), []);
});

test('filterPaths: every word, any case; names that match first', () => {
  const paths = ['src/app/style.css', 'style/readme.md', 'src/main.js', 'docs/Main.md'];
  assert.deepEqual(filterPaths(paths, 'style'), ['src/app/style.css', 'style/readme.md']);
  assert.deepEqual(filterPaths(paths, 'MAIN'), ['docs/Main.md', 'src/main.js']);
  assert.deepEqual(filterPaths(paths, 'src css'), ['src/app/style.css']);
  assert.deepEqual(filterPaths(paths, '   '), []);
  assert.equal(filterPaths(Array.from({ length: 500 }, (_, i) => `f${i}.js`), 'f', 50).length, 50);
});

test('trash: kept for 7 days, then expired; days left rounds up', () => {
  const day = 86400000;
  const now = 100 * day;
  const entries = [{ id: 1, deletedAt: now - 1 * day }, { id: 2, deletedAt: now - 7 * day + 1000 }, { id: 3, deletedAt: now - 8 * day }];
  assert.deepEqual(expired(entries, now).map((e) => e.id), [3]);
  assert.equal(TRASH_DAYS, 7);
  assert.equal(daysLeft(now, now), 7);
  assert.equal(daysLeft(now - 1 * day - 1000, now), 6);
  assert.equal(daysLeft(now - 9 * day, now), 0);
});
