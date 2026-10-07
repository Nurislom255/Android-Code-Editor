// Running JS, live preview, Markdown preview, formatting.
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, editorText, setText, writeProjectFile, runCommand } from './helpers.mjs';

const consoleLines = (page) => page.locator('#console-view .console-line');

async function jsProject(page, code) {
  await boot(page);
  await newProject(page, 'r', 'js');
  await openFile(page, 'main.js');
  await setText(page, code);
}

test('run JS: streamed console output, objects, result value and finish', async ({ page }) => {
  await jsProject(page, "console.log('hi', 1 + 1);\nconsole.log({ a: [1, 2] });\nconsole.warn('careful');\nsetTimeout(() => console.log('later'), 50);\n");
  await page.locator('#btn-run').click();
  await expect(consoleLines(page).filter({ hasText: 'hi 2' })).toHaveCount(1);
  await expect(consoleLines(page).filter({ hasText: '{ a: [ 1, 2 ] }' })).toHaveCount(1);
  await expect(page.locator('#console-view .console-line.warn')).toContainText('careful');
  await expect(consoleLines(page).filter({ hasText: 'later' })).toHaveCount(1);
  await expect(consoleLines(page).last()).toContainText('Finished');
});

test('runtime errors link back to the line; clicking jumps there', async ({ page }) => {
  await jsProject(page, 'const a = 1;\n\nfunction boom() {\n  return missing.value;\n}\nboom();\n');
  await runCommand(page, 'run');
  const link = page.locator('#console-view .console-line.error a').first();
  await expect(link).toHaveText(/main\.js:4:\d+/);
  await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 0 } }));
  await link.click();
  const line = await page.evaluate(() => { const s = window.__app.ws.view.state; return s.doc.lineAt(s.selection.main.head).number; });
  expect(line).toBe(4);
});

test('syntax errors point at the line', async ({ page }) => {
  await jsProject(page, 'let ok = 1;\nlet bad = ;\n');
  await runCommand(page, 'run');
  await expect(page.locator('#console-view .console-line.error').first()).toContainText('SyntaxError');
  await expect(page.locator('#console-view .console-line.error a').first()).toHaveText(/main\.js:2:\d+/);
});

test('an infinite loop is stopped by the time limit, and Stop works', async ({ page }) => {
  await boot(page, { runTimeLimit: 2 });
  await newProject(page, 'loop', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'while (true) {}\n');
  await runCommand(page, 'run');
  await expect(consoleLines(page).last()).toContainText('time limit', { timeout: 6000 });
  await expect(page.locator('#btn-run')).not.toHaveClass(/running/);
  // Stop button
  await setText(page, 'setInterval(() => console.log("tick"), 100);\n');
  await runCommand(page, 'run');
  await expect(consoleLines(page).filter({ hasText: 'tick' }).first()).toBeVisible();
  await page.locator('#bottom-panel .panel-actions [aria-label="Stop"]').click();
  await expect(consoleLines(page).last()).toContainText('Stopped');
});

test('stdin: readline() from the box, input() asks interactively', async ({ page }) => {
  await jsProject(page, "const a = readline();\nconst b = readline();\nconsole.log('sum', Number(a) + Number(b));\nconst name = await input('name? ');\nconsole.log('hello ' + name);\n");
  await runCommand(page, 'toggleConsole');
  await page.locator('#bottom-panel .panel-actions button', { hasText: 'stdin' }).click();
  await page.locator('.stdin-box textarea').fill('2\n40\n');
  await runCommand(page, 'run');
  await expect(consoleLines(page).filter({ hasText: 'sum 42' })).toHaveCount(1);
  const field = page.locator('.console-input-row input');
  await expect(field).toBeVisible();
  await field.fill('Ann');
  await field.press('Enter');
  await expect(consoleLines(page).filter({ hasText: 'hello Ann' })).toHaveCount(1);
  await expect(consoleLines(page).last()).toContainText('Finished');
});

test('HTML preview resolves linked CSS, JS, images, modules and fetch()', async ({ page }) => {
  await boot(page);
  await newProject(page, 'p', 'web');
  await writeProjectFile(page, 'css/site.css', "@import 'base.css';\nh1 { color: rgb(255, 0, 0); }\n.logo { background: url(../img/dot.svg); width: 10px; height: 10px; }\n");
  await writeProjectFile(page, 'css/base.css', 'body { margin: 7px; }\n');
  await writeProjectFile(page, 'img/dot.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  await writeProjectFile(page, 'js/util.js', 'export const double = (x) => x * 2;\n');
  await writeProjectFile(page, 'js/app.mjs', "import { double } from './util.js';\nconst r = await fetch('../data.json');\nconst d = await r.json();\nconsole.log('module', double(d.n));\ndocument.querySelector('#out').textContent = 'ok:' + double(d.n);\n");
  await writeProjectFile(page, 'data.json', '{"n": 21}');
  await writeProjectFile(page, 'page.html', '<!DOCTYPE html><html><head><link rel="stylesheet" href="css/site.css"></head><body><h1>Title</h1><div class="logo"></div><img id="pic" src="img/dot.svg"><p id="out"></p><script>console.log("classic", 1)</script><script type="module" src="js/app.mjs"></script></body></html>');
  await openFile(page, 'page.html');
  await runCommand(page, 'run');
  const frame = page.frameLocator('iframe.preview-frame');
  await expect(frame.locator('#out')).toHaveText('ok:42');
  await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(frame.locator('body')).toHaveCSS('margin-top', '7px');
  expect(await frame.locator('#pic').evaluate((img) => img.naturalWidth)).toBe(10);
  await runCommand(page, 'toggleConsole');
  await expect(consoleLines(page).filter({ hasText: 'module 42' })).toHaveCount(1);
  await expect(consoleLines(page).filter({ hasText: 'classic 1' })).toHaveCount(1);
});

test('preview updates from unsaved edits', async ({ page }) => {
  await boot(page);
  await newProject(page, 'live', 'web');
  await openFile(page, 'index.html');
  await runCommand(page, 'run');
  const frame = page.frameLocator('iframe.preview-frame');
  await expect(frame.locator('h1')).toHaveText('Hello, world!');
  const text = await editorText(page);
  await setText(page, text.replace('Hello, world!', 'Changed live'));
  await expect(frame.locator('h1')).toHaveText('Changed live');
});

test('Markdown preview renders, including relative images', async ({ page }) => {
  await boot(page);
  await newProject(page, 'md', 'empty');
  await writeProjectFile(page, 'docs/README.md', '# Notes\n\n- one\n- **two**\n\n![dot](dot.svg)\n\n```js\nlet a = 1;\n```\n');
  await writeProjectFile(page, 'docs/dot.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  await openFile(page, 'docs/README.md');
  await runCommand(page, 'run');
  const frame = page.frameLocator('iframe.preview-frame');
  await expect(frame.locator('h1')).toHaveText('Notes');
  await expect(frame.locator('strong')).toHaveText('two');
  expect(await frame.locator('img').getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
});

test('format document with Prettier keeps the cursor sane', async ({ page }) => {
  await jsProject(page, 'const  x={a:1,b:[1,2,3]}\nfunction f( a,b ){return a+b}\n');
  await runCommand(page, 'format');
  await expect.poll(() => editorText(page)).toBe('const x = { a: 1, b: [1, 2, 3] };\nfunction f(a, b) {\n  return a + b;\n}\n');
});

test('format reports syntax errors instead of mangling the file', async ({ page }) => {
  await jsProject(page, 'let = ;\n');
  await runCommand(page, 'format');
  await expect(page.locator('.toast-error')).toContainText('Format failed');
  expect(await editorText(page)).toBe('let = ;\n');
});
