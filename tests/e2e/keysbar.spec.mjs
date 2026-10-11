// The coding-keys bar (forced visible with keysBarMode: 'always'). Phone:
// two rows of 7; tablet: one row with two clusters (ROADMAP Phase 2).
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, editorText, setText } from './helpers.mjs';

test.skip(({ hasTouch }) => !hasTouch, 'touch-only');

async function setup(page, text = '', cursor = null, { file = 'main.js', template = 'js' } = {}) {
  await boot(page, { keysBarMode: 'always' });
  await newProject(page, 'k', template);
  await openFile(page, file);
  await setText(page, text, cursor);
  await expect(page.locator('#keys-bar')).toBeVisible();
}

/** A scratch file in a given language, cursor at "|". */
async function scratch(page, name, src) {
  await boot(page, { keysBarMode: 'always' });
  await page.evaluate(({ name, content }) => window.__app.ws.newUntitled({ name, content }), { name, content: src.replace('|', '') });
  await page.evaluate((at) => { const v = window.__app.ws.view; v.dispatch({ selection: { anchor: at } }); v.focus(); }, src.indexOf('|'));
  await expect(page.locator('#keys-bar')).toBeVisible();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const key = (page, label) => page.locator('#keys-bar .key').filter({ has: page.locator('.key-label', { hasText: new RegExp(`^${esc(label)}$`) }) }).first();
/** Icon keys (undo, multi-cursor) by their accessible name. */
const named = (page, prefix) => page.locator(`#keys-bar .keys-row .key[aria-label^="${prefix}"]`).first();
const loc = (page, k) => (typeof k === 'string' ? key(page, k) : k);
const isPhone = (page) => page.evaluate(() => document.getElementById('keys-bar').dataset.profile === 'phone');
const head = (page) => page.evaluate(() => window.__app.ws.view.state.selection.main.head);

async function touch(page) { return page.context().newCDPSession(page); }
async function center(page, label) {
  const b = await loc(page, label).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Swipes up (dy < 0) or down (dy > 0) on a key. */
async function swipeKey(page, label, dy, dx = 0) {
  const { x, y } = await center(page, label);
  const cdp = await touch(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx / 2, y: y + dy / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Holds a key; then (optionally) slides onto the popup choice `pick` and releases. */
async function holdKey(page, label, pick = null, { check } = {}) {
  const { x, y } = await center(page, label);
  const cdp = await touch(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(500);
  if (check) await check();
  if (pick) {
    const c = page.locator('.key-chooser .key-choice', { hasText: new RegExp(`^${esc(pick)}$`) });
    const b = await c.boundingBox();
    for (const f of [0.3, 0.7, 1]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (b.x + b.width / 2 - x) * f, y: y + (b.y + b.height / 2 - y) * f }] });
    await expect(c).toHaveClass(/on/);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('layout: no row scrolls and no key is narrower than 44 px (phone: 2 rows of 7)', async ({ page }) => {
  await setup(page, '');
  const rows = page.locator('#keys-bar .keys-row');
  if (await isPhone(page)) {
    await expect(rows).toHaveCount(2);
    for (const r of await rows.all()) await expect(r.locator(':scope > .key')).toHaveCount(7);
  } else {
    await expect(rows).toHaveCount(1);
  }
  for (const r of await rows.all()) expect(await r.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const widths = await page.locator('#keys-bar .keys-row .key').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(43.5);
  // no arrow keys (the joystick moves the cursor); Tab and Undo at the edges
  for (const arrow of ['←', '→', '↑', '↓']) await expect(key(page, arrow)).toHaveCount(0);
  await expect(page.locator('#keys-bar .key.joystick')).toHaveCount(1);
  // no duplicates: Redo is on Undo (swipe up / hold), not a key of its own
  await expect(page.locator('#keys-bar .keys-row .key[aria-label^="Redo"]')).toHaveCount(0);
  await expect(named(page, 'Multi-cursor')).toContainText('cursor'); // a caption says what it is
});

test('symbols follow the language and auto-close brackets (plus the pending ;)', async ({ page }) => {
  await setup(page, 'call');
  await key(page, '(').tap();
  // keys-bar typing goes through the same input handlers as the keyboard
  expect(await editorText(page)).toBe('call();');
  expect(await head(page)).toBe(5);
});

test('symbol variants: swipe up, swipe down, or hold and pick', async ({ page }) => {
  await setup(page, '');
  await swipeKey(page, '(', -30);
  expect(await editorText(page)).toBe(')');
  await swipeKey(page, '(', 30); // the second variant (a pair: the cursor goes inside)
  expect(await editorText(page)).toBe(')[]');
  await holdKey(page, '(', '{}', { check: () => expect(page.locator('.key-chooser .key-choice')).toHaveText(['(', ')', '[]', '{}']) });
  expect(await editorText(page)).toBe(')[{}]');
  expect(await head(page)).toBe(')[{'.length);
  await expect(page.locator('.key-chooser')).toHaveCount(0);
});

test('a key with one variant: holding types it, with a visible preview', async ({ page }) => {
  await scratch(page, 'a.css', 'p |');
  await holdKey(page, ':', null, { check: async () => {
    await expect(page.locator('.key-preview')).toBeVisible();
    await expect(page.locator('.key-preview-char')).toHaveText(';');
  } });
  expect(await editorText(page)).toBe('p ;');
  await expect(page.locator('.key-preview')).toHaveCount(0);
});

test('">" from the keys bar closes an HTML tag', async ({ page }) => {
  await setup(page, '<section', null, { file: 'index.html', template: 'web' });
  await page.waitForFunction(() => window.__app.ws.activeDoc.languageReady); // HTML mode loaded (auto-close tags)
  await swipeKey(page, '<', -30); // ">" is the first variant of "<" in the HTML layout
  expect(await editorText(page)).toBe('<section></section>');
});

test('context row: C++ after cout offers << and endl', async ({ page }) => {
  await scratch(page, 'main.cpp', 'int main() {\n    std::cout |\n}');
  await expect(key(page, '<<')).toBeVisible();
  await key(page, '<<').tap();
  expect(await editorText(page)).toBe('int main() {\n    std::cout << \n}');
  await expect(key(page, 'endl')).toBeVisible();
  const slot = await key(page, 'endl').evaluate((el) => [...el.parentElement.children].indexOf(el));
  await key(page, 'endl').tap();
  expect(await editorText(page)).toContain('std::cout << endl');
  // a statement start: std:: / cout <<
  await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'int main() {\n    \n}' }, selection: { anchor: 17 } }); });
  await expect(key(page, 'std::')).toBeVisible();
  expect(slot).toBeGreaterThanOrEqual(0);
});

test('context row: in an HTML tag, class="" puts the cursor between the quotes; typing " steps out', async ({ page }) => {
  await scratch(page, 'a.html', '<div |></div>');
  await key(page, 'class=""').tap();
  expect(await editorText(page)).toBe('<div class=""></div>');
  expect(await head(page)).toBe('<div class="'.length);
  await page.keyboard.type('box"');
  expect(await editorText(page)).toBe('<div class="box"></div>');
  expect(await head(page)).toBe('<div class="box"'.length);
});

test('pairs from the keys bar: the cursor goes inside; typing the closer steps over it', async ({ page }) => {
  await setup(page, 'let a = ');
  // ( swiped left: {}, swiped down: []
  await swipeKey(page, '(', 0, -30);
  expect(await editorText(page)).toBe('let a = {}');
  expect(await head(page)).toBe('let a = {'.length);
  await page.keyboard.type('x}');
  expect(await editorText(page)).toBe('let a = {x}');
  expect(await head(page)).toBe('let a = {x}'.length);
  await swipeKey(page, '(', 30);
  expect(await editorText(page)).toBe('let a = {x}[]');
  expect(await head(page)).toBe('let a = {x}['.length);
  // a context key ending in a pair: if (|), then typing ")" doesn't double it
  await setText(page, '', 0);
  await page.waitForTimeout(300);
  await key(page, 'if ()').tap();
  await page.keyboard.type('ok)');
  expect(await editorText(page)).toBe('if (ok)');
});

test('pairs: nested printf("|") steps over both closers; with auto-close off pairs stay whole', async ({ page }) => {
  await scratch(page, 'a.c', 'int main() {\n    |\n}');
  await key(page, 'printf("")').tap();
  await page.keyboard.type('hi")');
  expect(await editorText(page)).toBe('int main() {\n    printf("hi");\n}'); // (; the automatic semicolon)
  expect(await head(page)).toBe('int main() {\n    printf("hi")'.length);
  // with auto-close off the pair is still whole
  await page.evaluate(() => window.__app.updateSettings({ autoCloseBrackets: false }));
  await setText(page, 'int b = ', 8);
  await swipeKey(page, '(', 0, -30);
  expect(await editorText(page)).toMatch(/^int b = \{\};?$/); // (maybe the automatic ;)
  expect(await head(page)).toBe('int b = {'.length);
});

test('Python: """ from the keys bar makes a docstring with the cursor inside', async ({ page }) => {
  await scratch(page, 'a.py', 'def f():\n    |');
  await page.evaluate(() => window.__app.keysBar.typeSymbol('"""'));
  expect(await editorText(page)).toBe('def f():\n    """"""');
  expect(await head(page)).toBe('def f():\n    """'.length);
});

test('context keys keep their slot while they are still offered', async ({ page }) => {
  await scratch(page, 'main.cpp', 'int main() {\n    std::cout << x|\n}');
  const pos = (label) => key(page, label).evaluate((el) => [...el.parentElement.children].indexOf(el));
  await expect(key(page, 'endl')).toBeVisible();
  const before = await pos('endl');
  await page.keyboard.type(' ');
  await page.waitForTimeout(250);
  expect(await pos('endl')).toBe(before);
});

test('line key: tap = new line below; swipe moves the line; hold opens the line fan', async ({ page }) => {
  await setup(page, 'a\nb', 0);
  await swipeKey(page, '↵', 30);
  expect(await editorText(page)).toBe('b\na');
  await swipeKey(page, '↵', -30);
  expect(await editorText(page)).toBe('a\nb');
  await key(page, '↵').tap();
  expect(await editorText(page)).toBe('a\n\nb');
  await setText(page, 'one\ntwo', 0);
  await holdKey(page, '↵', 'Dup', { check: async () => {
    await expect(page.locator('.key-chooser .key-choice')).toHaveText(['⏎;', '↥', 'Dup', 'Join', '✕Ln', '//']);
    await expect(key(page, '↵')).toHaveClass(/holding/); // felt (vibration) and seen
  } });
  expect(await editorText(page)).toBe('one\none\ntwo');
  // releasing without sliding onto a choice does nothing
  await holdKey(page, '↵');
  expect(await editorText(page)).toBe('one\none\ntwo');
});

/** Drags the joystick by `dx`, `dy` px in `n` moves, `ms` apart (explicit times: speed matters). */
async function dragJoystick(page, { dx = 0, dy = 0, n = 10, ms = 60, wobble = 0 }) {
  const j = await page.locator('#keys-bar .key.joystick').boundingBox();
  const x = j.x + j.width / 2, y = j.y + j.height / 2;
  const cdp = await touch(page);
  const t0 = Date.now() / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: t0 });
  for (let i = 1; i <= n; i++) {
    const w = wobble ? Math.sin(i) * wobble : 0;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / n + (dy ? w : 0), y: y + (dy * i) / n + (dx ? w : 0) }], timestamp: t0 + (i * ms) / 1000 });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + ((n + 1) * ms) / 1000 });
  await cdp.detach();
}

test('joystick: slow = precise, fast = far; it sticks to one direction; tap selects the word', async ({ page }) => {
  await setup(page, 'alpha beta gamma delta epsilon\nsecond line here', 0);
  // 60 px slowly: a few characters
  await dragJoystick(page, { dx: 60, n: 10, ms: 60 });
  const slow = await head(page);
  expect(slow).toBeGreaterThanOrEqual(2);
  expect(slow).toBeLessThanOrEqual(4);
  // the same 60 px fast: much further
  await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 0 } }));
  await dragJoystick(page, { dx: 60, n: 10, ms: 4 });
  expect(await head(page)).toBeGreaterThanOrEqual(slow * 2);
  // a sideways drag with the finger wobbling up and down stays on the line
  await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 0 } }));
  await dragJoystick(page, { dx: 90, n: 15, ms: 50, wobble: 14 });
  expect(await page.evaluate(() => window.__app.ws.view.state.doc.lineAt(window.__app.ws.view.state.selection.main.head).number)).toBe(1);
  // tap: the word
  await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 1 } }));
  await page.locator('#keys-bar .key.joystick').tap();
  expect(await page.evaluate(() => { const s = window.__app.ws.view.state.selection.main; return [s.from, s.to]; })).toEqual([0, 5]);
});

test('joystick: the line end is a wall; pushing on for a moment goes to the next line', async ({ page }) => {
  const line = () => page.evaluate(() => window.__app.ws.view.state.doc.lineAt(window.__app.ws.view.state.selection.main.head).number);
  await setup(page, 'abc\nsecond\nthird', 0);
  // overshooting past "abc" stops at its end
  await dragJoystick(page, { dx: 70, n: 14, ms: 15 });
  expect(await head(page)).toBe(3);
  // pushing on (well over half a second): through to the next line
  await dragJoystick(page, { dx: 70, n: 35, ms: 40 });
  expect(await line()).toBe(2);
  // and the start of a line stops a drag to the left the same way
  await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 6 } }));
  await dragJoystick(page, { dx: -70, n: 14, ms: 15 });
  expect(await head(page)).toBe(4);
});

test('joystick: a quick flick right goes to the line end', async ({ page }) => {
  await setup(page, 'alpha beta gamma', 0);
  await dragJoystick(page, { dx: 64, n: 2, ms: 40 });
  expect(await head(page)).toBe('alpha beta gamma'.length);
});

test('modifiers: Ctrl then S saves; Shift + joystick selects; Esc appears when useful', async ({ page }) => {
  await setup(page, 'hello world', 0);
  expect(await page.evaluate(() => window.__app.ws.activeDoc.dirty)).toBe(true);
  const phone = await isPhone(page);
  if (phone) await key(page, 'Mod').tap();
  await key(page, 'Ctrl').tap();
  await key(page, 'S').tap();
  await expect.poll(() => page.evaluate(() => window.__app.ws.activeDoc.dirty)).toBe(false);
  // Ctrl was one-shot: the row is back to normal
  await expect(key(page, 'S')).toHaveCount(0);

  if (phone) await key(page, 'Mod').tap();
  await key(page, 'Shift').tap();
  await dragJoystick(page, { dx: 60, n: 10, ms: 60 });
  const sel = await page.evaluate(() => { const s = window.__app.ws.view.state.selection.main; return [s.from, s.to]; });
  expect(sel[0]).toBe(0);
  expect(sel[1]).toBeGreaterThanOrEqual(2);
  // something selected: Esc is offered (phone: in the context row); it deselects
  await key(page, 'Esc').tap();
  expect(await page.evaluate(() => window.__app.ws.view.state.selection.main.empty)).toBe(true);
  if (phone) await expect(key(page, 'Esc')).toHaveCount(0);
});

test('Mod layer: Home and End (with Shift they select)', async ({ page }) => {
  await setup(page, 'abc def', 3);
  test.skip(!(await isPhone(page)), 'the tablet has no Mod layer');
  await key(page, 'Mod').tap();
  await expect(key(page, '⇧Tab')).toHaveCount(0); // (on Tab already)
  await key(page, 'End').tap();
  expect(await head(page)).toBe(7);
  // (the layer stays open for more Home / End; Shift closes it, armed)
  await key(page, 'Shift').tap();
  await expect(named(page, 'Modifiers')).toContainText('⇧'); // the Mod key shows what is armed
  await named(page, 'Modifiers').tap();
  await key(page, 'Home').tap();
  expect(await page.evaluate(() => { const s = window.__app.ws.view.state.selection.main; return [s.anchor, s.head]; })).toEqual([7, 0]);
});

test('operator key: tap +, swipe up -, down *, left /, right ** (power), hold for the rest', async ({ page }) => {
  await setup(page, 'a ');
  await key(page, '+').tap();
  await swipeKey(page, '+', -30);
  await swipeKey(page, '+', 30);
  await swipeKey(page, '+', 0, -30);
  await swipeKey(page, '+', 0, 30);
  // a swipe that starts sideways and ends up going up is a swipe up
  await swipeKey(page, '+', -32, 10);
  await holdKey(page, '+', '%', { check: () => expect(page.locator('.key-chooser .key-choice')).toHaveCount(13) });
  expect(await editorText(page)).toBe('a +-*/**-%');
  // the hints sit on the side of each swipe
  const op = key(page, '+');
  await expect(op.locator('.alt-left')).toHaveText('/');
  await expect(op.locator('.alt-right')).toHaveText('**');
  // "(" swiped left: {}
  await swipeKey(page, '(', 0, -30);
  expect(await editorText(page)).toBe('a +-*/**-%{}');
});

test('operator key in C++: no power operator, so right is % (pow() comes as a suggestion)', async ({ page }) => {
  await scratch(page, 'main.cpp', 'int main() {\n    int x = |\n}');
  await swipeKey(page, '+', 0, 30);
  expect(await editorText(page)).toContain('int x = %');
  await page.evaluate(() => { const v = window.__app.ws.view; const p = v.state.doc.toString().indexOf('%'); v.dispatch({ changes: { from: p, to: p + 1 }, selection: { anchor: p } }); });
  await expect(page.locator('#keys-bar .key.ctx', { hasText: 'pow()' })).toBeVisible();
});

test('context keys never repeat a key of the main row', async ({ page }) => {
  await scratch(page, 'main.cpp', 'int main() {\n    total|\n}');
  const labels = await page.locator('#keys-bar .key.ctx .key-label').allTextContents();
  const main = await page.locator('#keys-bar .key.sym:not(.ctx) .key-label').allTextContents();
  expect(labels).toContain('.');
  for (const m of main) {
    expect(labels).not.toContain(m);
    expect(labels).not.toContain({ '(': '()', '{': '{}', '[': '[]', '"': '""' }[m] || '\u0000');
  }
  expect(new Set(labels.filter(Boolean)).size).toBe(labels.filter(Boolean).length); // nothing twice
});

test('multi-cursor key: tap adds a cursor below, typing goes to every line', async ({ page }) => {
  await setup(page, 'let a = 1\nlet b = 2\nlet c = 3', 'let a = 1'.length);
  await named(page, 'Multi-cursor').tap();
  await named(page, 'Multi-cursor').tap();
  expect(await page.evaluate(() => window.__app.ws.view.state.selection.ranges.length)).toBe(3);
  await page.keyboard.type(';');
  expect(await editorText(page)).toBe('let a = 1;\nlet b = 2;\nlet c = 3;');
});

test('the "More" sheet has every key: ⫶ cursors on each line, Home / End', async ({ page }) => {
  await setup(page, 'one\ntwo\nthree');
  await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); });
  await key(page, '⋯').tap();
  await expect(page.locator('.keys-sheet')).toBeVisible();
  await expect(page.locator('.keys-sheet-title')).toContainText(['Lines', 'Cursors', 'Selection', 'Navigation', 'Editing']);
  await key(page, '⫶').tap();
  await expect(page.locator('.keys-sheet')).toHaveCount(0); // closes after a key
  expect(await page.evaluate(() => window.__app.ws.view.state.selection.ranges.length)).toBe(3);
  await page.keyboard.type('!');
  expect(await editorText(page)).toBe('one!\ntwo!\nthree!');
  await setText(page, 'abc', 1);
  await key(page, '⋯').tap();
  await key(page, 'End').tap();
  expect(await head(page)).toBe(3);
});

test('a key in the sheet acts once: holding it never keeps deleting', async ({ page }) => {
  await setup(page, 'abcdef', 6);
  await key(page, '⋯').tap();
  await holdKey(page, '⌫');
  await page.waitForTimeout(500);
  expect((await editorText(page)).length).toBeGreaterThanOrEqual(5);
  if (await page.locator('.keys-sheet').count() === 0) await key(page, '⋯').tap();
  await key(page, '⌫').tap();
  await page.waitForTimeout(300);
  expect(['abcde', 'abcd']).toContain(await editorText(page));
  await expect(page.locator('.keys-sheet')).toHaveCount(0);
});

test('Tab and Undo: the corner symbol by swipe up or hold (Shift+Tab, Redo)', async ({ page }) => {
  await setup(page, 'x', 0);
  // (edits closer than half a second apart are one undo step)
  await page.waitForTimeout(600);
  await key(page, 'Tab').tap();
  expect(await editorText(page)).toBe('  x');
  await page.waitForTimeout(600);
  await swipeKey(page, 'Tab', -30);
  expect(await editorText(page)).toBe('x');
  await page.waitForTimeout(600);
  await key(page, 'Tab').tap();
  await page.waitForTimeout(600);
  await holdKey(page, 'Tab');
  expect(await editorText(page)).toBe('x');
  const undo = named(page, 'Undo');
  await undo.tap();
  expect(await editorText(page)).toBe('  x');
  await swipeKey(page, undo, -30);
  expect(await editorText(page)).toBe('x');
  await undo.tap();
  await holdKey(page, undo);
  expect(await editorText(page)).toBe('x');
});

test('custom key layout from settings', async ({ page }) => {
  await setup(page, '');
  await page.evaluate(() => window.__app.updateSettings({ keysLayouts: { ...window.__app.settings.keysLayouts, js: '@^# $^%' } }));
  await expect(key(page, '$')).toBeVisible();
  await key(page, '$').tap();
  expect(await editorText(page)).toBe('$');
});

test('the bar hides when the keyboard closes, also after the window changes size', async ({ page }) => {
  await boot(page);
  await newProject(page, 'kb', 'js');
  await openFile(page, 'main.js');
  await page.evaluate(() => window.__app.ws.view.focus());
  const size = page.viewportSize();
  const bar = page.locator('#keys-bar');
  await expect(bar).toBeHidden(); // focused, but no keyboard
  await page.setViewportSize({ width: size.width, height: size.height - 320 }); // keyboard opens
  await expect(bar).toBeVisible();
  await page.setViewportSize(size); // keyboard closes
  await expect(bar).toBeHidden();
  // split-screen: a narrower, shorter window is not a keyboard
  await page.setViewportSize({ width: size.width - 60, height: Math.round(size.height * 0.55) });
  await expect(bar).toBeHidden();
});
