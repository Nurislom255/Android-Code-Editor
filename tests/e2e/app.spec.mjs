// Settings, offline start, scratch files, large-file behaviour (spec §6/§8).
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, editorText, setText, writeProjectFile } from './helpers.mjs';

test('settings apply live and persist across reloads', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__app.showPanel('settings'));
  const panel = page.locator('.side-panel[data-panel="settings"]');
  await panel.getByLabel('Theme').selectOption('light');
  await expect(page.locator('html')).toHaveClass(/theme-light/);
  await panel.getByLabel('Font size').fill('18');
  await panel.getByLabel('Font size').press('Enter');
  await panel.getByLabel('Font size').blur();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ed-font-size').trim())).toBe('18px');
  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  await expect(page.locator('html')).toHaveClass(/theme-light/);
  expect(await page.evaluate(() => window.__app.settings.fontSize)).toBe(18);
});

test('scratch file works without any project', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: /Scratch file/ }).click();
  await expect(page.locator('.tab.active .tab-name')).toHaveText('scratch.js');
  await setText(page, 'console.log(6 * 7)');
  await page.locator('#btn-run').click();
  await expect(page.locator('#console-view .console-line', { hasText: '42', hasNotText: 'Finished' })).toHaveCount(1); // not "✓ Finished in 42 ms"
});

test('a 5,000-line file stays responsive while typing (spec §8 benchmark)', async ({ page }) => {
  await boot(page);
  await newProject(page, 'big', 'empty');
  const lines = [];
  for (let i = 0; i < 5000; i++) lines.push(i % 10 === 0 ? `function f${i}(a, b) {` : i % 10 === 9 ? '}' : `  const v${i} = a * ${i} + b; // line ${i}`);
  await writeProjectFile(page, 'big.js', lines.join('\n') + '\n');
  await openFile(page, 'big.js');
  await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ selection: { anchor: Math.floor(v.state.doc.length / 2) }, scrollIntoView: true }); v.focus(); });
  // Time from keystroke to the next painted frame, averaged.
  const ms = await page.evaluate(async () => {
    const v = window.__app.ws.view;
    const times = [];
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      v.dispatch(v.state.replaceSelection('x'), { userEvent: 'input.type' });
      await new Promise((r) => requestAnimationFrame(() => r()));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  });
  console.log(`median keystroke→frame: ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(50); // a frame is 16 ms; generous bound for slow CI machines
});

test('a minified one-line file opens with highlighting off instead of freezing', async ({ page }) => {
  await boot(page);
  await newProject(page, 'min', 'empty');
  const code = 'var a=1;'.repeat(40000); // 320 KB on one line
  await writeProjectFile(page, 'lib.min.js', code);
  const t = Date.now();
  await openFile(page, 'lib.min.js');
  expect(Date.now() - t).toBeLessThan(5000);
  await expect(page.locator('.toast', { hasText: 'Highlighting is off' })).toBeVisible();
  expect(await page.evaluate(() => window.__app.ws.view.lineWrapping)).toBe(false);
  expect((await editorText(page)).length).toBe(code.length);
});

test('works offline after the first visit (service worker)', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(baseURL);
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && reg.active);
  }, null, { timeout: 20000 });
  await page.reload(); // now controlled by the worker
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  await page.getByRole('button', { name: /Scratch file/ }).click();
  await setText(page, '[1, 2, 3].map((n) => n * 2)');
  await page.locator('#btn-run').click();
  await expect(page.locator('#console-view .console-line.result')).toContainText('[ 2, 4, 6 ]');
  // a lazily loaded chunk (Python mode) also comes from the cache
  await page.evaluate(() => window.__app.ws.newUntitled({ name: 'x.py', content: 'def f():\n    pass\n' }));
  await expect(page.locator('.pane.focused-pane .tok-keyword').first()).toHaveText('def');
  await ctx.close();
});

test('interface size zooms the menus and bars, not the code', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: /Scratch file/ }).click();
  const bar = () => page.locator('#titlebar').boundingBox();
  const code = () => page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')).fontSize);
  const h0 = (await bar()).height, f0 = await code();
  await page.evaluate(() => window.__app.updateSettings({ uiZoom: 130 }));
  expect((await bar()).height).toBeCloseTo(h0 * 1.3, 0);
  expect(await code()).toBe(f0);
  // the command palette still fits the screen
  await page.evaluate(() => window.__app.run('commandPalette'));
  const pal = await page.locator('.palette').boundingBox();
  expect(pal.x + pal.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
});

test('Android: classic keyboard input by default (keeps auto-capitals off)', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: /Scratch file/ }).click();
  const usesEditContext = () => page.evaluate(() => !!window.__app.ws.view.contentDOM.editContext);
  expect(await usesEditContext()).toBe(false);
  expect(await page.evaluate(() => window.__app.ws.view.contentDOM.getAttribute('autocapitalize'))).toBe('off');
});

test('F5 runs the file; Ctrl+Enter inserts a line below in the editor', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: /Scratch file/ }).click();
  await setText(page, 'console.log(6 * 7)', 3);
  await page.keyboard.press('F5');
  await expect(page.locator('#console-view .console-line', { hasText: '42', hasNotText: 'Finished' })).toHaveCount(1); // not "✓ Finished in 42 ms"
  await page.evaluate(() => window.__app.ws.view.focus());
  await page.keyboard.press('Control+Enter');
  expect(await page.evaluate(() => window.__app.ws.view.state.doc.toString())).toBe('console.log(6 * 7)\n');
});

test('bottom panel: the whole bar resizes, dragging it down closes it, ✕ is always on screen', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: /Scratch file/ }).click();
  await page.evaluate(() => window.__app.bottom.show('console'));
  const panel = page.locator('#bottom-panel');
  const head = page.locator('#bottom-panel .panel-head');
  const close = page.locator('#bottom-panel [aria-label="Close panel"]');
  await expect(page.locator('#panel-resizer')).toHaveCount(0); // the bar is the only handle
  const vw = page.viewportSize().width;
  const c = await close.boundingBox();
  expect(c.x + c.width).toBeLessThanOrEqual(vw + 1);
  const h0 = (await panel.boundingBox()).height;
  const hb = await head.boundingBox();
  // drag from the middle of the bar (between the tabs and the buttons) upward
  const x = hb.x + hb.width * 0.62, y = hb.y + hb.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 40, { steps: 4 });
  await page.mouse.move(x, y - 80, { steps: 4 });
  await page.mouse.up();
  expect((await panel.boundingBox()).height).toBeGreaterThan(h0 + 60);
  // drag it almost to the bottom → closed
  const hb2 = await head.boundingBox();
  await page.mouse.move(x, hb2.y + 20);
  await page.mouse.down();
  await page.mouse.move(x, page.viewportSize().height - 5, { steps: 8 });
  await page.mouse.up();
  await expect(panel).toBeHidden();
});

test('hover highlights only follow a mouse: a tapped button does not stay lit', async ({ page, hasTouch }) => {
  await boot(page);
  const html = page.locator('html');
  if (hasTouch) {
    await page.locator('#titlebar button').first().tap();
    await expect(html).not.toHaveClass(/can-hover/);
  } else {
    await page.mouse.move(200, 200);
    await expect(html).toHaveClass(/can-hover/);
  }
});

test('status bar: one line, never cut off — what does not fit is in ⋯', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: /Scratch file/ }).click();
  const bar = page.locator('#statusbar');
  await page.waitForTimeout(100);
  const over = await bar.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  const more = bar.locator('[data-key="more"]');
  if (await more.isVisible()) {
    // whatever is hidden is reachable from the menu, e.g. soft wrap
    const wrapHidden = await bar.locator('[data-key="wrap"]').evaluate((el) => el.classList.contains('sb-overflowed'));
    await more.click();
    if (wrapHidden) {
      const wrapBefore = await page.evaluate(() => window.__app.ws.activeDoc.wrap);
      await page.locator('.menu-item', { hasText: 'Soft wrap' }).click();
      expect(await page.evaluate(() => window.__app.ws.activeDoc.wrap)).toBe(!wrapBefore);
    } else {
      await expect(page.locator('.popup-menu')).toBeVisible();
    }
  }
});
