// "Never lose user data" (spec §6): encodings/line endings preserved,
// external changes detected, local history, EditorConfig.
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, editorText, setText, writeProjectFile, readProjectBytes, runCommand } from './helpers.mjs';

const resume = (page) => page.evaluate(() => window.__app.onResume());

test('CRLF line endings and the UTF-8 BOM survive an edit + save', async ({ page }) => {
  await boot(page);
  await newProject(page, 'crlf', 'empty');
  const bytes = [0xef, 0xbb, 0xbf, ...Buffer.from('line1\r\nline2\r\n')];
  await writeProjectFile(page, 'win.txt', null, { bytes });
  await openFile(page, 'win.txt');
  await expect(page.locator('#statusbar')).toContainText('CRLF');
  await expect(page.locator('#statusbar')).toContainText('UTF-8 BOM');
  expect(await editorText(page)).toBe('line1\nline2\n');
  await setText(page, 'line1\nline2\nline3\n');
  await runCommand(page, 'save');
  await expect(page.locator('.tab.active')).not.toHaveClass(/dirty/);
  const out = await readProjectBytes(page, 'win.txt');
  expect(out.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
  expect(Buffer.from(out.slice(3)).toString()).toBe('line1\r\nline2\r\nline3\r\n');
});

test('invalid UTF-8 opens read-only instead of risking corruption', async ({ page }) => {
  await boot(page);
  await newProject(page, 'latin', 'empty');
  await writeProjectFile(page, 'latin1.txt', null, { bytes: [0x63, 0x61, 0x66, 0xe9, 0x0a] }); // "café" in Latin-1
  await openFile(page, 'latin1.txt');
  expect(await page.evaluate(() => window.__app.ws.view.state.readOnly)).toBe(true);
  await expect(page.locator('#statusbar')).toContainText('Unknown encoding');
});

test('file changed by another app: clean buffer reloads, dirty buffer shows a conflict bar', async ({ page }) => {
  await boot(page);
  await newProject(page, 'ext', 'web');
  await openFile(page, 'style.css');
  await page.waitForTimeout(30);
  await writeProjectFile(page, 'style.css', 'body { color: green; }\n');
  await resume(page);
  await expect.poll(() => editorText(page)).toBe('body { color: green; }\n');
  await expect(page.locator('.tab.active')).not.toHaveClass(/dirty/);

  await setText(page, 'body { color: mine; }\n');
  await page.waitForTimeout(30);
  await writeProjectFile(page, 'style.css', 'body { color: theirs; }\n');
  await resume(page);
  await expect(page.locator('.pane.focused-pane .conflict-bar')).toBeVisible();
  expect(await editorText(page)).toBe('body { color: mine; }\n');
  await page.locator('.conflict-bar').getByRole('button', { name: 'Use disk version' }).click();
  expect(await editorText(page)).toBe('body { color: theirs; }\n');
  await expect(page.locator('.pane.focused-pane .conflict-bar')).toBeHidden();
});

test('saving over a file that changed on disk asks first', async ({ page }) => {
  await boot(page);
  await newProject(page, 'ow', 'web');
  await openFile(page, 'app.js');
  await setText(page, '// mine\n');
  await page.waitForTimeout(30);
  await writeProjectFile(page, 'app.js', '// someone else\n');
  await page.evaluate(() => { window.__app.run('save'); });
  await expect(page.locator('.modal-title')).toHaveText('File changed on disk');
  await page.locator('.modal').getByRole('button', { name: 'Overwrite with mine' }).click();
  await expect(page.locator('.tab.active')).not.toHaveClass(/dirty/);
  expect(Buffer.from(await readProjectBytes(page, 'app.js')).toString()).toBe('// mine\n');
});

test('local history keeps a snapshot per save and can restore one', async ({ page }) => {
  await boot(page);
  await newProject(page, 'hist', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'version 1\n');
  await runCommand(page, 'save');
  await setText(page, 'version 2\n');
  await runCommand(page, 'save');
  await page.evaluate(() => window.__app.showPanel('history'));
  await expect(page.locator('.side-panel[data-panel="history"] .list-row')).toHaveCount(2);
  await page.locator('.side-panel[data-panel="history"] .list-row').nth(1).getByRole('button', { name: 'Restore' }).click();
  expect(await editorText(page)).toBe('version 1\n');
  await expect(page.locator('.tab.active')).toHaveClass(/dirty/);
});

test('.editorconfig sets indentation and trims trailing whitespace on save', async ({ page }) => {
  await boot(page);
  await newProject(page, 'ec', 'empty');
  await writeProjectFile(page, '.editorconfig', 'root = true\n[*]\nindent_style = space\nindent_size = 4\ntrim_trailing_whitespace = true\ninsert_final_newline = true\n');
  await writeProjectFile(page, 'a.js', '');
  await openFile(page, 'a.js');
  await expect(page.locator('#statusbar')).toContainText('Spaces: 4');
  await setText(page, 'let a = 1;   \nlet b = 2;');
  await runCommand(page, 'save');
  expect(Buffer.from(await readProjectBytes(page, 'a.js')).toString()).toBe('let a = 1;\nlet b = 2;\n');
});

test('export as .zip and import it back as a new project', async ({ page }) => {
  await boot(page);
  await newProject(page, 'zipme', 'web');
  await setText(page, '<p>unsaved edit</p>\n');
  const download = page.waitForEvent('download');
  await runCommand(page, 'exportZip');
  const file = await download;
  expect(file.suggestedFilename()).toBe('zipme.zip');
  const zipPath = await file.path();
  await page.locator('#zip-input').setInputFiles(zipPath);
  await page.locator('.modal input').fill('zipme-copy');
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#project-name')).toHaveText('zipme-copy');
  const html = await page.evaluate(() => window.__app.project.fs.readText('index.html'));
  expect(html).toBe('<p>unsaved edit</p>\n');
  expect(await page.evaluate(() => window.__app.project.fs.exists('style.css'))).toBe(true);
});
