// Keyboard shortcuts as data (core/keybindings.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCombo, formatCombo, comboFromEvent, comboProblem, effectiveKey, conflictsOf, resolveCombo, normalizeBindings, parseBinding, bindingProblem, chordsFrom, prefixClashes, effectiveBindings } from '../../src/core/keybindings.js';

test('shortcuts are written one way', () => {
  assert.equal(parseCombo('ctrl+shift+k'), 'Ctrl+Shift+K');
  assert.equal(parseCombo('Shift+Alt+↓'), 'Shift+Alt+↓');
  assert.equal(parseCombo('Alt+Shift+Down'), 'Shift+Alt+↓', 'modifiers in a fixed order, arrows as arrows');
  assert.equal(parseCombo('Ctrl+Shift+\\'), 'Ctrl+Shift+\\');
  assert.equal(parseCombo('Ctrl++'), 'Ctrl+=', '+ is the = key');
  assert.equal(parseCombo('Ctrl+-'), 'Ctrl+-');
  assert.equal(parseCombo('f5'), 'F5');
  assert.equal(parseCombo('Esc'), 'Esc');
  assert.equal(parseCombo('Cmd+Escape'), 'Cmd+Esc');
  assert.equal(parseCombo('PageDown'), 'PgDn');
  assert.equal(parseCombo('Ctrl+Hyper+K'), null);
  assert.equal(parseCombo('Ctrl+'), null);
  assert.equal(parseCombo(''), null);
  assert.equal(formatCombo({ alt: true, ctrl: true, key: 'Enter' }), 'Ctrl+Alt+Enter');
});

test('a keydown → its shortcut (punctuation by the key pressed, not what Shift makes of it)', () => {
  const ev = (o) => ({ key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(comboFromEvent(ev({ key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+K');
  assert.equal(comboFromEvent(ev({ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+\\');
  assert.equal(comboFromEvent(ev({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })), 'Alt+↑');
  assert.equal(comboFromEvent(ev({ key: 'F5', code: 'F5' })), 'F5');
  assert.equal(comboFromEvent(ev({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true })), 'Ctrl+Alt+Enter');
  assert.equal(comboFromEvent(ev({ key: 'л', code: 'KeyK', ctrlKey: true })), 'Ctrl+K', 'another alphabet: the key under the finger');
  assert.equal(comboFromEvent(ev({ key: 's', code: 'KeyS', metaKey: true }), { mac: true }), 'Ctrl+S', '⌘ is Ctrl on a Mac');
  assert.equal(comboFromEvent(ev({ key: 'Unidentified', keyCode: 229 })), null, 'a soft keyboard composing');
  assert.equal(comboFromEvent(ev({ key: 'b', code: 'KeyB', isComposing: true })), null, 'a letter while composing is typing');
  // Gboard composing a word, a hardware Ctrl+B / F5: still shortcuts
  assert.equal(comboFromEvent(ev({ key: 'b', code: 'KeyB', ctrlKey: true, isComposing: true })), 'Ctrl+B');
  assert.equal(comboFromEvent(ev({ key: 'Unidentified', code: 'KeyB', keyCode: 229, ctrlKey: true, isComposing: true })), 'Ctrl+B', 'named by the physical key');
  assert.equal(comboFromEvent(ev({ key: 'F5', code: 'F5', keyCode: 229, isComposing: true })), 'F5');
  assert.equal(comboFromEvent(ev({ key: 'Unidentified', code: '', keyCode: 229, ctrlKey: true })), null, 'no name at all');
  assert.equal(comboFromEvent(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true })), null, 'a lone modifier');
});

test('which shortcuts may be used', () => {
  assert.equal(comboProblem('Ctrl+E'), null);
  assert.equal(comboProblem('Alt+↑'), null);
  assert.equal(comboProblem('F6'), null);
  assert.match(comboProblem('K'), /Ctrl or Alt/);
  assert.match(comboProblem('Shift+K'), /Ctrl or Alt/);
  assert.match(comboProblem('nonsense'), /Not a shortcut/);
});

test('defaults, the owner\'s changes, conflicts, and what a key press does', () => {
  const defaults = { deleteLine: 'Ctrl+Shift+K', save: 'Ctrl+S', find: 'Ctrl+F', selectNext: 'Ctrl+D', foldAll: '' };
  const overrides = { deleteLine: 'Ctrl+E', selectNext: '' };
  assert.equal(effectiveKey('deleteLine', defaults, overrides), 'Ctrl+E');
  assert.equal(effectiveKey('save', defaults, overrides), 'Ctrl+S');
  assert.equal(effectiveKey('selectNext', defaults, overrides), '', 'removed');
  assert.deepEqual(conflictsOf('Ctrl+S', 'deleteLine', defaults, overrides), ['save']);
  assert.deepEqual(conflictsOf('Ctrl+D', 'deleteLine', defaults, overrides), [], 'Ctrl+D is free now');
  assert.deepEqual(resolveCombo('Ctrl+E', defaults, overrides), { run: 'deleteLine' });
  assert.deepEqual(resolveCombo('Ctrl+Shift+K', defaults, overrides), { swallow: true }, 'the old default does nothing');
  assert.deepEqual(resolveCombo('Ctrl+D', defaults, overrides), { swallow: true });
  assert.equal(resolveCombo('Ctrl+S', defaults, overrides), null, 'untouched: the defaults handle it');
  // the owner gives Find's key to Save: Ctrl+F saves
  assert.deepEqual(resolveCombo('Ctrl+F', defaults, { save: 'Ctrl+F' }), { run: 'save' });
});

test('stored changes are cleaned', () => {
  const defaults = { deleteLine: 'Ctrl+Shift+K', save: 'Ctrl+S', foldAll: '' };
  assert.deepEqual(normalizeBindings({ deleteLine: 'ctrl+e', save: 'Ctrl+S', foldAll: '', nope: 'Ctrl+Q', x: 'K' }, defaults), { deleteLine: 'Ctrl+E' },
    'canonical; same as default dropped; removing a missing shortcut dropped; unknown command and plain key dropped');
  assert.deepEqual(normalizeBindings({ deleteLine: '', a: 'alt+up' }), { deleteLine: '', a: 'Alt+↑' }, 'without defaults (settings): only the form');
  assert.deepEqual(normalizeBindings('junk'), {});
});

test('two-key shortcuts (VS Code chords): written several ways, one canonical form', () => {
  assert.equal(parseBinding('Ctrl+K F'), 'Ctrl+K F');
  assert.equal(parseBinding('ctrl+k, ctrl+0'), 'Ctrl+K Ctrl+0');
  assert.equal(parseBinding('Ctrl + K then f'), 'Ctrl+K F');
  assert.equal(parseBinding('Ctrl+K Enter'), 'Ctrl+K Enter');
  assert.equal(parseBinding('Ctrl+Shift+K'), 'Ctrl+Shift+K', 'one key still works');
  assert.equal(parseBinding('Ctrl+K F G'), null, 'at most two keys');
  assert.equal(parseBinding('Ctrl+K Nope'), null);
  assert.equal(bindingProblem('Ctrl+K F'), null);
  assert.match(bindingProblem('K F'), /starts with Ctrl, Alt or Cmd/);
  assert.match(bindingProblem('Ctrl+K Esc'), /Esc cancels/);
  assert.match(bindingProblem('K'), /Ctrl or Alt/);
  // the second key of a chord: a plain letter, even while a keyboard is composing
  const ev = (o) => ({ key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(comboFromEvent(ev({ key: 'Unidentified', code: 'KeyF', keyCode: 229, isComposing: true }), { anyKey: true }), 'F');
  assert.equal(comboFromEvent(ev({ key: 'Unidentified', code: 'KeyF', keyCode: 229, isComposing: true })), null);
});

test('two-key shortcuts: which start with a key, and what clashes with what', () => {
  const defaults = { closeProject: 'Ctrl+K F', foldAll: 'Ctrl+K Ctrl+0', save: 'Ctrl+S', zen: 'Ctrl+Alt+Z' };
  assert.deepEqual(chordsFrom('Ctrl+K', defaults), [['Ctrl+K F', 'closeProject'], ['Ctrl+K Ctrl+0', 'foldAll']], 'plain second keys first');
  assert.deepEqual(chordsFrom('Ctrl+K', defaults, { closeProject: '' }), [['Ctrl+K Ctrl+0', 'foldAll']], 'one taken off');
  assert.deepEqual(chordsFrom('Ctrl+S', defaults), []);
  assert.deepEqual(chordsFrom('Ctrl+J', defaults, { zen: 'Ctrl+J Z' }), [['Ctrl+J Z', 'zen']], 'the owner\'s own');
  // Ctrl+K alone vs. Ctrl+K …: they can't both work
  assert.deepEqual(prefixClashes('Ctrl+K', 'save', defaults).sort(), ['closeProject', 'foldAll']);
  assert.deepEqual(prefixClashes('Ctrl+S Q', 'zen', defaults), ['save']);
  assert.deepEqual(prefixClashes('Ctrl+K Q', 'zen', defaults), []);
  assert.deepEqual(effectiveBindings(defaults, { save: '', zen: 'Ctrl+J Z' }), { closeProject: 'Ctrl+K F', foldAll: 'Ctrl+K Ctrl+0', zen: 'Ctrl+J Z' });
  // stored changes: chords kept, canonical
  assert.deepEqual(normalizeBindings({ zen: 'ctrl+k, z', save: 'K F' }, defaults), { zen: 'Ctrl+K Z' });
});
