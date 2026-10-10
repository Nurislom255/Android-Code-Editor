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
const isPhone = (page) => page.evaluate(() => document.getElementById('keys-bar').dataset.profile === 'phone');
const head = (page) => page.evaluate(() => window.__app.ws.view.state.selection.main.head);

async function touch(page) { return page.context().newCDPSession(page); }
async function center(page, label) {
  const b = await key(page, label).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Swipes up (dy < 0) or down (dy > 0) on a key. */
async function swipeKey(page, label, dy) {
  const { x, y } = await center(page, label);
  const cdp = await touch(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy }] });
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
  await swipeKey(page, '(', 30); // the second variant
  expect(await editorText(page)).toBe(')[]');
  await holdKey(page, '(', '{}', { check: () => expect(page.locator('.key-chooser .key-choice')).toHaveText(['(', ')', '[]', '{}']) });
  expect(await editorText(page)).toBe(')[]{}');
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

test('context row: in an HTML tag, class="" puts the cursor between the quotes', async ({ page }) => {
  await scratch(page, 'a.html', '<div |></div>');
  await key(page, 'class=""').tap();
  expect(await editorText(page)).toBe('<div class=""></div>');
  expect(await head(page)).toBe('<div class="'.length);
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

test('joystick: drag moves the cursor, tap selects the word, flick right = line end', async ({ page }) => {
  await setup(page, 'alpha beta gamma', 0);
  const j = await page.locator('#keys-bar .key.joystick').boundingBox();
  const x = j.x + j.width / 2, y = j.y + j.height / 2;
  const cdp = await touch(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 6, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await head(page)).toBe(3); // 36 px → 3 characters
  await page.locator('#keys-bar .key.joystick').tap();
  expect(await page.evaluate(() => { const s = window.__app.ws.view.state.selection.main; return [s.from, s.to]; })).toEqual([0, 5]);
  await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 0 } }));
  const t0 = Date.now() / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: t0 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 30, y }], timestamp: t0 + 0.05 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 60, y }], timestamp: t0 + 0.1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.12 });
  expect(await head(page)).toBe('alpha beta gamma'.length);
  await cdp.detach();
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
  const j = await page.locator('#keys-bar .key.joystick').boundingBox();
  const x = j.x + j.width / 2, y = j.y + j.height / 2;
  const cdp = await touch(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 7, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  expect(await page.evaluate(() => { const s = window.__app.ws.view.state.selection.main; return [s.from, s.to]; })).toEqual([0, 3]);
  // something selected: Esc is offered (phone: in the context row); it deselects
  await key(page, 'Esc').tap();
  expect(await page.evaluate(() => window.__app.ws.view.state.selection.main.empty)).toBe(true);
  if (phone) await expect(key(page, 'Esc')).toHaveCount(0);
});

test('cursors key: tap adds a cursor below, typing goes to every line', async ({ page }) => {
  await setup(page, 'let a = 1\nlet b = 2\nlet c = 3', 'let a = 1'.length);
  await key(page, '+⇣').tap();
  await key(page, '+⇣').tap();
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

test('Tab: tap indents, hold outdents; Undo: tap undoes, hold redoes', async ({ page }) => {
  await setup(page, 'x', 0);
  // (edits closer than half a second apart are one undo step)
  await page.waitForTimeout(600);
  await key(page, 'Tab').tap();
  expect(await editorText(page)).toBe('  x');
  await page.waitForTimeout(600);
  await holdKey(page, 'Tab');
  expect(await editorText(page)).toBe('x');
  await key(page, '↶').tap();
  expect(await editorText(page)).toBe('  x');
  await holdKey(page, '↶');
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
