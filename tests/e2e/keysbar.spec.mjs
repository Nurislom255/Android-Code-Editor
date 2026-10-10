// The coding-keys bar (forced visible with keysBarMode: 'always').
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, editorText, setText } from './helpers.mjs';

test.skip(({ hasTouch }) => !hasTouch, 'touch-only');

async function setup(page, text = '', cursor = null) {
  await boot(page, { keysBarMode: 'always' });
  await newProject(page, 'k', 'js');
  await openFile(page, 'main.js');
  await setText(page, text, cursor);
  await expect(page.locator('#keys-bar')).toBeVisible();
}

/** Swipes up on a key (types its corner symbol). */
async function swipeUpKey(page, label) {
  const b = await key(page, label).boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 15 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 30 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const key = (page, label) => page.locator('#keys-bar .key', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first();

test('symbol row matches the language and auto-closes brackets (plus the pending ;)', async ({ page }) => {
  await setup(page, 'call');
  await expect(page.locator('#keys-bar .keys-symbols .key').first()).toContainText('{');
  await key(page, '(').tap();
  // keys-bar typing goes through the same input handlers as the keyboard:
  // auto-closed ")" and the automatic semicolon after a call
  expect(await editorText(page)).toBe('call();');
  const cursor = await page.evaluate(() => window.__app.ws.view.state.selection.main.head);
  expect(cursor).toBe(5); // between the parentheses
});

test('the first keys row scrolls sideways when dragged on a key', async ({ page }) => {
  await setup(page, '');
  const row = page.locator('#keys-bar .keys-actions');
  const max = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
  test.skip(max < 20, 'row fits on this screen');
  // Put the "Dup" key in the middle, then drag the row from it (the
  // trackpad strip keeps touch-action: none on purpose).
  await row.evaluate((el) => { const k = [...el.querySelectorAll('.key')].find((b) => b.textContent === 'Dup'); el.scrollLeft = k.offsetLeft - el.clientWidth / 2; });
  const s0 = await row.evaluate((el) => el.scrollLeft);
  const dir = max - s0 > 80 ? -1 : 1; // finger left scrolls toward the end
  const kb = await key(page, 'Dup').boundingBox();
  const x0 = kb.x + kb.width / 2, y = kb.y + kb.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }], timestamp: t0 });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dir * i * 18, y }], timestamp: t0 + i * 0.03 });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.3 });
  await expect.poll(() => row.evaluate((el, a) => Math.abs(el.scrollLeft - a), s0)).toBeGreaterThan(40);
  expect(await editorText(page)).toBe(''); // "Dup" under the finger did not fire
});

test('">" from the keys bar closes an HTML tag', async ({ page }) => {
  await boot(page, { keysBarMode: 'always' });
  await newProject(page, 'kh', 'web');
  await openFile(page, 'index.html');
  await setText(page, '<section');
  await swipeUpKey(page, '<'); // ">" is the swipe-up symbol of "<" in the HTML row
  expect(await editorText(page)).toBe('<section></section>');
});

test('⏎; completes the statement and starts a new line', async ({ page }) => {
  await setup(page, 'function f() {\n  const total = add(1, 2\n}', 'function f() {\n  const total = add(1, 2'.length);
  await key(page, '⏎;').tap();
  expect(await editorText(page)).toBe('function f() {\n  const total = add(1, 2);\n  \n}');
  const head = await page.evaluate(() => window.__app.ws.view.state.selection.main.head);
  expect(head).toBe('function f() {\n  const total = add(1, 2);\n  '.length);
});

test('swipe up on a key types its alternate symbol', async ({ page }) => {
  await setup(page, 'x ');
  const k = key(page, '=');
  const b = await k.boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy); // pointer events: drag upward on the key
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 15 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 30 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await editorText(page)).toBe('x =>');
});

/** A touch path on a key, with real timestamps (ms after the start). */
async function touchPath(page, label, points, endAt) {
  const b = await key(page, label).boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }], timestamp: t0 });
  for (const [dx, dy, t] of points) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx, y: cy + dy }], timestamp: t0 + t / 1000 });
  }
  if (endAt) await page.waitForTimeout(endAt);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: Date.now() / 1000 });
  await cdp.detach();
}

test('a leaning, curved swipe up still types the corner symbol', async ({ page }) => {
  await setup(page, 'x ');
  // up and to the right, curving further right at the end
  await touchPath(page, '=', [[6, -6, 20], [14, -16, 40], [24, -26, 60], [36, -32, 80]]);
  expect(await editorText(page)).toBe('x =>');
});

test('holding a symbol key types its corner symbol, with a visible preview while held', async ({ page }) => {
  await setup(page, 'x ');
  const b = await key(page, '=').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await page.waitForTimeout(550);
  await expect(page.locator('.key-preview')).toBeVisible();
  await expect(page.locator('.key-preview-char')).toHaveText('=>');
  await expect(key(page, '=')).toHaveClass(/swiped/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect(page.locator('.key-preview')).toHaveCount(0);
  expect(await editorText(page)).toBe('x =>');
  // a quick tap is still the main symbol
  await key(page, '=').tap();
  expect(await editorText(page)).toBe('x =>=');
});

test('a sideways drag on a symbol key types nothing (it scrolls the row)', async ({ page }) => {
  await setup(page, 'x ');
  await touchPath(page, '=', [[-12, 1, 20], [-30, 2, 40], [-60, 3, 60]]);
  expect(await editorText(page)).toBe('x ');
});

test('Home/End with the Shift modifier, and Tab (no arrow keys any more)', async ({ page }) => {
  await setup(page, 'abc', 3);
  for (const arrow of ['←', '→', '↑', '↓']) await expect(page.locator('#keys-bar .key', { hasText: new RegExp(`^${arrow}$`) })).toHaveCount(0);
  await key(page, 'Home').tap();
  expect(await page.evaluate(() => window.__app.ws.view.state.selection.main.head)).toBe(0);
  await page.locator('#keys-bar .key.mod', { hasText: '⇧' }).tap();
  await key(page, 'End').tap();
  const sel = await page.evaluate(() => { const s = window.__app.ws.view.state.selection.main; return [s.from, s.to]; });
  expect(sel).toEqual([0, 3]);
  // Shift was one-shot: it released after one use
  await expect(page.locator('#keys-bar .key.mod', { hasText: '⇧' })).not.toHaveClass(/armed/);
  await setText(page, 'x', 0);
  await key(page, 'Tab').tap();
  expect(await editorText(page)).toBe('  x');
});

test('the most used line keys come first; Sel+ is gone (Ctrl+D does it)', async ({ page }) => {
  await setup(page, '');
  await expect(page.locator('#keys-bar .key', { hasText: /^Sel\+$/ })).toHaveCount(0);
  const labels = await page.locator('#keys-bar .keys-actions .key').evaluateAll((els) => els.slice(0, 5).map((e) => e.textContent));
  expect(labels).toEqual(['Tab', '⏎;', '↵Ln', '⇡Ln', '⇣Ln']);
});

test('multi-line editing: +⇣ adds cursors, typing goes to every line', async ({ page }) => {
  await setup(page, 'let a = 1\nlet b = 2\nlet c = 3', 'let a = 1'.length);
  const add = page.locator('#keys-bar .key[title^="Add a cursor on the line below"]');
  await add.scrollIntoViewIfNeeded();
  await add.tap();
  await add.tap();
  expect(await page.evaluate(() => window.__app.ws.view.state.selection.ranges.length)).toBe(3);
  await page.keyboard.type(';');
  expect(await editorText(page)).toBe('let a = 1;\nlet b = 2;\nlet c = 3;');
});

test('multi-line editing: ⫶ puts a cursor on each selected line', async ({ page }) => {
  await setup(page, 'one\ntwo\nthree');
  await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); });
  const k = key(page, '⫶');
  await k.scrollIntoViewIfNeeded();
  await k.tap();
  expect(await page.evaluate(() => window.__app.ws.view.state.selection.ranges.length)).toBe(3);
  await page.keyboard.type('!');
  expect(await editorText(page)).toBe('one!\ntwo!\nthree!');
});

test('trackpad strip moves the cursor by dragging', async ({ page }) => {
  await setup(page, 'abcdefghij', 0);
  const pad = page.locator('#keys-bar .key.trackpad');
  await pad.scrollIntoViewIfNeeded();
  const b = await pad.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 10, y }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + 10 + i * 11, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const head = await page.evaluate(() => window.__app.ws.view.state.selection.main.head);
  expect(head).toBe(6);
});

test('line operations: duplicate, move, delete, comment', async ({ page }) => {
  await setup(page, 'a\nb', 0);
  await key(page, 'Dup').tap();
  expect(await editorText(page)).toBe('a\na\nb');
  await key(page, '//').tap();
  expect(await editorText(page)).toMatch(/^a\n\/\/ a\nb$|^\/\/ a\na\nb$/);
  await setText(page, 'a\nb', 0);
  await key(page, '⇣Ln').tap();
  expect(await editorText(page)).toBe('b\na');
  await key(page, '✕Ln').tap();
  expect(await editorText(page)).toBe('b');
});

test('custom key layout from settings', async ({ page }) => {
  await setup(page, '');
  await page.evaluate(() => window.__app.updateSettings({ keysLayouts: { ...window.__app.settings.keysLayouts, js: '@^# $^%' } }));
  await expect(page.locator('#keys-bar .keys-symbols .key')).toHaveCount(2);
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
