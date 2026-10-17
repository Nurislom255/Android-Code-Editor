// The keys bar as data (core/keysLayout.js: DEFAULT_BAR, barProblem, normalizeBar, pinToBar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BAR, barProblem, normalizeBar, barFor, pinToBar, barKeyInfo } from '../../src/core/keysLayout.js';
import { normalizeSettings } from '../../src/core/settings.js';

test('the defaults are valid bars', () => {
  for (const [profile, rows] of Object.entries(DEFAULT_BAR)) assert.equal(barProblem(rows, profile), null, profile);
});

test('a bar keeps Tab, ⋯ and the modifiers, fits, and knows its keys', () => {
  const phone = DEFAULT_BAR.phone.map((r) => r.slice());
  assert.equal(barProblem([phone[0], phone[1].filter((k) => k !== 'tab')], 'phone'), 'Tab must stay on the bar.');
  assert.match(barProblem([phone[0].filter((k) => k !== 'more'), phone[1]], 'phone'), /all keys/);
  assert.match(barProblem([phone[0].filter((k) => k !== 'mod'), phone[1]], 'phone'), /Mod/);
  assert.equal(barProblem([[...phone[0].filter((k) => k !== 'mod'), 'ctrl'], [...phone[1].slice(0, 5), 'shift', 'alt']], 'phone'), null, 'Ctrl, Shift and Alt instead of Mod');
  assert.match(barProblem([[...phone[0], 'ctx', 'ctx'], phone[1]], 'phone'), /At most 8/);
  assert.equal(barProblem([phone[0], [...phone[1].slice(0, 6), '@save']], 'phone'), null, 'an action key');
  assert.equal(barProblem([phone[0], [...phone[1].slice(0, 6), 's:(^)^[]']], 'phone'), null, 'a fixed symbol key');
  assert.equal(barProblem([phone[0], [...phone[1].slice(0, 6), '@nope']], 'phone'), 'Unknown key.');
  assert.equal(barProblem([phone[0]], 'phone'), 'Wrong number of rows.');
  assert.deepEqual(barKeyInfo('@save'), { label: 'Save', title: 'Save' });
  assert.equal(barKeyInfo('s:(^)').label, '(');
});

test('stored bars: only valid profiles; the rest follow the defaults', () => {
  const mine = [['mod', 'ctx', 'ctx', 'more'], ['tab', 'joystick', 'sym', '@save', 'undo']];
  const n = normalizeBar({ phone: mine, tablet: [['tab']], junk: 1 });
  assert.deepEqual(n, { phone: mine });
  assert.deepEqual(barFor(n, 'phone'), mine);
  assert.deepEqual(barFor(n, 'tablet'), DEFAULT_BAR.tablet);
  assert.deepEqual(normalizeSettings({ keysBar: { phone: mine } }).keysBar, { phone: mine });
  assert.deepEqual(normalizeSettings({}).keysBar, {});
});

test('pinning a key from the All-keys sheet', () => {
  const pinned = pinToBar(DEFAULT_BAR.phone, 'phone', '@save');
  assert.deepEqual(pinned[0], ['mod', 'ctx', 'ctx', 'ctx', '@save', 'cursors', 'more'], 'it takes the last context key');
  assert.deepEqual(DEFAULT_BAR.phone[0][4], 'ctx', 'the default is untouched');
  const noCtx = [['mod', 'cursors', 'more'], ['tab', 'joystick', 'sym', 'line', 'undo']];
  assert.deepEqual(pinToBar(noCtx, 'phone', '@find')[0], ['mod', 'cursors', '@find', 'more'], 'no context key: before ⋯');
  const full = [Array(8).fill('ctx').map((k, i) => (i === 0 ? 'mod' : i === 7 ? 'more' : 'sym')), ['tab', ...Array(7).fill('sym')]];
  assert.equal(pinToBar(full, 'phone', '@find'), null, 'no room');
});

test('a symbol key from its fields (Settings → Keys bar)', async () => {
  const { tokenProblem } = await import('../../src/core/keysLayout.js');
  assert.equal(tokenProblem(['(', ')', '[]', '{}', '<>']), null);
  assert.equal(tokenProblem(['|', '^']), null, 'the caret as a variant');
  assert.equal(tokenProblem(['+', '-', '', '/']), 'Fill the swipes in order (up, down, left, right): no gaps.');
  assert.equal(tokenProblem(['', ')']), 'A tap must type something.');
  assert.equal(tokenProblem(['a b']), 'No spaces inside a key.');
  assert.equal(tokenProblem(['x', 'a^b']), '^ can only be a key on its own.');
  assert.equal(tokenProblem(['(', ')'], ['[]', '{}']), null, 'hold-only variants');
});

test('catalog keys: "@name" is an action only when it exists', async () => {
  const { catalogId } = await import('../../src/core/keysLayout.js');
  assert.equal(catalogId('@save'), '@save');
  assert.equal(catalogId('@'), 's:@', 'the @ symbol');
  assert.equal(catalogId('@^~'), 's:@^~', "JavaScript's @ key with ~ on swipe");
  assert.equal(catalogId('('), 's:(');
});
