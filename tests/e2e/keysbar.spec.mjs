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

const key = (page, label) => page.locator('#keys-bar .key', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first();

test('symbol row matches the language and auto-closes brackets', async ({ page }) => {
  await setup(page, 'call');
  await expect(page.locator('#keys-bar .keys-symbols .key').first()).toContainText('{');
  await key(page, '(').tap();
  expect(await editorText(page)).toBe('call()');
  const cursor = await page.evaluate(() => window.__app.ws.view.state.selection.main.head);
  expect(cursor).toBe(5); // between the parentheses
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

test('arrow keys, Shift modifier and Tab', async ({ page }) => {
  await setup(page, 'abc', 3);
  await key(page, '←').tap();
  await key(page, '←').tap();
  expect(await page.evaluate(() => window.__app.ws.view.state.selection.main.head)).toBe(1);
  await page.locator('#keys-bar .key.mod', { hasText: '⇧' }).tap();
  await key(page, '→').tap();
  const sel = await page.evaluate(() => { const s = window.__app.ws.view.state.selection.main; return [s.from, s.to]; });
  expect(sel).toEqual([1, 2]);
  // Shift was one-shot: it released after one use
  await expect(page.locator('#keys-bar .key.mod', { hasText: '⇧' })).not.toHaveClass(/armed/);
  await setText(page, 'x', 0);
  await key(page, 'Tab').tap();
  expect(await editorText(page)).toBe('  x');
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
