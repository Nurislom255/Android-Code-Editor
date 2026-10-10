// Touch gestures on the code, driven with real touch events (CDP).
import { test, expect } from '@playwright/test';
import {
  boot, newProject, openFile, editorText, setText, codePoint, swipe, pinch, twoFingerTap, completionOpen,
} from './helpers.mjs';

test.skip(({ hasTouch }) => !hasTouch, 'touch-only');

async function jsFile(page, text, cursor = null) {
  await boot(page);
  await newProject(page, 'g', 'js');
  await openFile(page, 'main.js');
  await setText(page, text, cursor);
}

const right = async (page, fingers = 1) => {
  const p = await codePoint(page, 0.25, 0.5);
  await swipe(page, { from: p, to: { x: p.x + 160, y: p.y + 4 }, fingers });
};
const left = async (page, fingers = 1) => {
  const p = await codePoint(page, 0.75, 0.5);
  await swipe(page, { from: p, to: { x: p.x - 160, y: p.y - 4 }, fingers });
};

test('swipe right accepts the highlighted autocomplete suggestion', async ({ page }) => {
  await jsFile(page, 'const documentTitle = 1;\ndocumentT');
  await page.evaluate(() => window.__app.run('autocomplete')); // open the list like typing would
  await expect(completionOpen(page)).toBeVisible();
  await right(page);
  await expect(completionOpen(page)).toHaveCount(0);
  expect(await editorText(page)).toBe('const documentTitle = 1;\ndocumentTitle');
  await expect(page.locator('#gesture-hint')).toHaveText('Completed');
});

test('swipe right with no list open shows suggestions; typing then swiping completes', async ({ page }) => {
  await jsFile(page, 'let counterValue = 0;\ncou');
  await right(page);
  await expect(completionOpen(page)).toBeVisible();
  await expect(page.locator('#gesture-hint')).toHaveText('Suggestions');
  await page.waitForTimeout(120);
  await right(page);
  expect(await editorText(page)).toBe('let counterValue = 0;\ncounterValue');
});

test('swipe right expands a snippet and then jumps between its fields', async ({ page }) => {
  await jsFile(page, 'fori');
  await right(page); // open list
  await expect(completionOpen(page)).toBeVisible();
  await expect(page.locator('.cm-completionLabel', { hasText: /^fori$/ }).first()).toBeVisible();
  await right(page);
  const text = await editorText(page);
  expect(text).toContain('for (let i = 0; i < array.length; i++) {');
  // cursor sits on the first field "i"; swipe right → next field "array"
  await right(page);
  const sel = await page.evaluate(() => { const s = window.__app.ws.view.state; return s.sliceDoc(s.selection.main.from, s.selection.main.to); });
  expect(sel).toBe('array');
});

test('a 30° diagonal swipe still autocompletes, and the cursor does not jump to the finger', async ({ page }) => {
  await jsFile(page, 'const documentTitle = 1;\nlet other = 2;\nlet third = 3;\ndocumentT');
  await page.evaluate(() => window.__app.run('autocomplete'));
  await expect(completionOpen(page)).toBeVisible();
  const p = await codePoint(page, 0.2, 0.1); // on the first line, far from the cursor
  await swipe(page, { from: p, to: { x: p.x + 150, y: p.y + Math.round(150 * Math.tan(Math.PI / 6)) } });
  expect(await editorText(page)).toBe('const documentTitle = 1;\nlet other = 2;\nlet third = 3;\ndocumentTitle');
  const head = await page.evaluate(() => window.__app.ws.view.state.selection.main.head);
  expect(head).toBe((await editorText(page)).length);
});

test('a horizontal drag that is not a swipe leaves the cursor where it was', async ({ page }) => {
  await jsFile(page, 'let a = 1;\nlet b = 2;\nlet c = 3;', 3);
  const p = await codePoint(page, 0.2, 0.1);
  await swipe(page, { from: p, to: { x: p.x + 160, y: p.y + 30 }, duration: 1200, steps: 14 }); // too slow
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__app.ws.view.state.selection.main.head)).toBe(3);
  expect(await editorText(page)).toBe('let a = 1;\nlet b = 2;\nlet c = 3;');
});

test('the Settings test pad explains how a swipe was read', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__app.showPanel('settings'));
  const pad = page.locator('.gesture-pad');
  await pad.scrollIntoViewIfNeeded();
  const b = await pad.boundingBox();
  const y = b.y + b.height / 2;
  await swipe(page, { from: { x: b.x + b.width * 0.2, y }, to: { x: b.x + b.width * 0.2 + 150, y: y + 10 } });
  await expect(page.locator('.gesture-pad-result')).toContainText('✓ Swipe right, 1 finger');
  await expect(page.locator('.gesture-pad-result')).toContainText('Autocomplete');
  await swipe(page, { from: { x: b.x + b.width * 0.2, y }, to: { x: b.x + b.width * 0.2 + 150, y: y + 5 }, duration: 1500, steps: 12 });
  await expect(page.locator('.gesture-pad-result')).toContainText('too slow');
});

test('swipe left closes the list, then deletes the previous word', async ({ page }) => {
  await jsFile(page, 'let alpha = 1;\nconst beta = alp');
  await page.evaluate(() => window.__app.run('autocomplete'));
  await expect(completionOpen(page)).toBeVisible();
  await left(page);
  await expect(completionOpen(page)).toHaveCount(0);
  expect(await editorText(page)).toBe('let alpha = 1;\nconst beta = alp');
  await left(page);
  expect(await editorText(page)).toBe('let alpha = 1;\nconst beta = ');
  await expect(page.locator('#gesture-hint')).toHaveText('Deleted word');
});

test('two-finger swipes undo and redo', async ({ page }) => {
  await jsFile(page, '');
  await page.keyboard.type('hello');
  await page.waitForTimeout(800); // separate undo group
  await page.keyboard.type(' world');
  expect(await editorText(page)).toBe('hello world');
  await left(page, 2);
  expect(await editorText(page)).toBe('hello');
  await right(page, 2);
  expect(await editorText(page)).toBe('hello world');
});

test('slow drags and vertical flicks do not trigger commands', async ({ page }) => {
  await jsFile(page, 'let a = 1;\nlet b = 2');
  const p = await codePoint(page, 0.2, 0.5);
  await swipe(page, { from: p, to: { x: p.x + 160, y: p.y }, duration: 1200, steps: 12 });
  await swipe(page, { from: p, to: { x: p.x + 10, y: p.y - 150 }, duration: 150 });
  await expect(completionOpen(page)).toHaveCount(0);
  expect(await editorText(page)).toBe('let a = 1;\nlet b = 2');
});

test('a horizontal flick that scrolls a long line is a scroll, not a command', async ({ page }) => {
  const long = `const s = "${'x'.repeat(400)}";\nlet tail = 1;\n`;
  await jsFile(page, long, long.length);
  await page.evaluate(() => { const d = window.__app.ws.activeDoc; window.__app.ws.setWrap(d.id, false); });
  await page.evaluate(() => { window.__app.ws.view.scrollDOM.scrollLeft = 0; });
  const before = await editorText(page);
  // finger moves left → content scrolls right (there is room to scroll)
  await left(page);
  await page.waitForTimeout(200);
  const scrolled = await page.evaluate(() => window.__app.ws.view.scrollDOM.scrollLeft);
  expect(scrolled).toBeGreaterThan(0);
  expect(await editorText(page)).toBe(before);
});

test('pinch zooms the code font and remembers it', async ({ page }) => {
  await jsFile(page, 'let a = 1;');
  const before = await page.evaluate(() => window.__app.settings.fontSize);
  await pinch(page, { center: await codePoint(page, 0.5, 0.5), startGap: 80, endGap: 160 });
  const after = await page.evaluate(() => window.__app.settings.fontSize);
  expect(after).toBeGreaterThan(before);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('codeeditor:settings')).fontSize);
  expect(stored).toBe(after);
});

test('two-finger tap opens the command palette', async ({ page }) => {
  await jsFile(page, 'let a = 1;');
  await twoFingerTap(page, await codePoint(page, 0.5, 0.5));
  await expect(page.locator('.palette')).toBeVisible();
});

test('triple-tap a line deletes it; undo brings it back', async ({ page }) => {
  await jsFile(page, 'let a = 1;\nlet b = 2;\nlet c = 3;', 0);
  const line2 = page.locator('.pane.focused-pane .cm-line').nth(1);
  const r = await line2.boundingBox();
  const at = { x: r.x + 40, y: r.y + r.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  for (let i = 0; i < 3; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }], timestamp: t0 + i * 0.18 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + i * 0.18 + 0.05 });
  }
  await cdp.detach();
  await expect.poll(() => editorText(page)).toBe('let a = 1;\nlet c = 3;');
  await expect(page.locator('#gesture-hint')).toContainText('Line deleted');
  await page.evaluate(() => window.__app.run('undo'));
  expect(await editorText(page)).toBe('let a = 1;\nlet b = 2;\nlet c = 3;');
});

test('tap a line number to select the line', async ({ page }) => {
  await jsFile(page, 'one\ntwo\nthree\n');
  const num = page.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^2$/ });
  await num.tap();
  const sel = await page.evaluate(() => { const s = window.__app.ws.view.state; return s.sliceDoc(s.selection.main.from, s.selection.main.to); });
  expect(sel).toBe('two\n');
});

test('gestures can be remapped in settings', async ({ page }) => {
  await jsFile(page, 'abc');
  await page.evaluate(() => window.__app.updateSettings({ gestureMap: { ...window.__app.settings.gestureMap, 'swipe-left-1': 'toggleComment' } }));
  await left(page);
  expect(await editorText(page)).toBe('// abc');
});

test('swiping the status bar switches tabs', async ({ page }) => {
  await boot(page);
  await newProject(page, 'tabs', 'web');
  await openFile(page, 'style.css');
  const bar = await page.locator('#statusbar').boundingBox();
  const y = bar.y + bar.height / 2;
  await swipe(page, { from: { x: bar.x + bar.width * 0.7, y }, to: { x: bar.x + bar.width * 0.2, y } });
  await expect(page.locator('.tab.active .tab-name')).not.toHaveText('style.css');
});
