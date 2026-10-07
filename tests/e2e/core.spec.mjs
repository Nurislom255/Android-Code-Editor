import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, editorText, setText, focusEditor, readProjectBytes, mod } from './helpers.mjs';

test('create a web project, edit, save, and the tab shows dirty state', async ({ page }) => {
  await boot(page);
  await newProject(page, 'site', 'web');
  await expect(page.locator('.tab.active .tab-name')).toHaveText('index.html');
  await page.evaluate(() => window.__app.showPanel('files'));
  for (const f of ['index.html', 'style.css', 'main.js', 'app.js']) {
    await expect(page.locator(`.tree-row[data-path="${f}"]`)).toHaveCount(1);
  }
  await page.evaluate(() => window.__app.layout.closeDrawer());
  await openFile(page, 'app.js');
  await setText(page, 'const answer = 42;\n');
  await expect(page.locator('.tab.active')).toHaveClass(/dirty/);
  await focusEditor(page);
  await page.keyboard.press(`${mod}+s`);
  await expect(page.locator('.tab.active')).not.toHaveClass(/dirty/);
  const bytes = await readProjectBytes(page, 'app.js');
  expect(Buffer.from(bytes).toString()).toBe('const answer = 42;\n');
});

test('session and unsaved buffers survive a reload (process death)', async ({ page }) => {
  await boot(page);
  await newProject(page, 'keep', 'web');
  await openFile(page, 'main.js');
  await setText(page, '// unsaved work\nlet x = 1;\n');
  // Recovery mirrors dirty buffers ~1.5 s after typing stops; hiding the page
  // flushes immediately (what happens when Android backgrounds the app).
  await page.evaluate(async () => { await window.__app.recovery.flushAll(); await window.__app.ws.saveSession(); });
  await page.reload();
  await page.waitForFunction(() => window.__app && window.__app.project);
  await expect(page.locator('#project-name')).toHaveText('keep');
  await expect(page.locator('.tab', { hasText: 'main.js' })).toHaveClass(/dirty/);
  await page.locator('.tab', { hasText: 'main.js' }).click();
  expect(await editorText(page)).toBe('// unsaved work\nlet x = 1;\n');
  await expect(page.locator('.tab', { hasText: 'index.html' })).toHaveCount(1);
});

test('closing a dirty tab asks to save', async ({ page }) => {
  await boot(page);
  await newProject(page, 'ask', 'web');
  await openFile(page, 'style.css');
  await setText(page, 'body { color: red; }\n');
  await page.locator('.tab.active .tab-close').click();
  await expect(page.locator('.modal-title')).toHaveText('Unsaved changes');
  await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.tab', { hasText: 'style.css' })).toHaveCount(0);
  const bytes = await readProjectBytes(page, 'style.css');
  expect(Buffer.from(bytes).toString()).toBe('body { color: red; }\n');
});

test('status bar shows cursor position, indentation, line endings and language', async ({ page }) => {
  await boot(page);
  await newProject(page, 'status', 'web');
  await openFile(page, 'app.js');
  await setText(page, 'a\nbcd', 4);
  const sb = page.locator('#statusbar');
  await expect(sb).toContainText('Ln 2, Col 3');
  await expect(sb).toContainText('Spaces: 2');
  await expect(sb).toContainText('LF');
  await expect(sb).toContainText('JavaScript');
});
