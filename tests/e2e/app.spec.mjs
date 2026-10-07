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
  await expect(page.locator('#console-view .console-line', { hasText: '42' })).toHaveCount(1);
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
