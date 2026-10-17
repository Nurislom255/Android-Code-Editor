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
  // "Program input" is a button on wide screens, in ⋯ on a phone
  const inputBtn = page.locator('#bottom-panel .panel-actions button', { hasText: 'Input' });
  if (await inputBtn.isVisible()) await inputBtn.click();
  else {
    await page.locator('#bottom-panel [aria-label="More console actions"]').click();
    await page.locator('.menu-item', { hasText: 'Program input' }).click();
  }
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

test('preview errors name the file and line, not the generated page', async ({ page }) => {
  await boot(page);
  await newProject(page, 'pe', 'web');
  await writeProjectFile(page, 'app.js', "// app.js\nconsole.log('app ok');\n/\n");
  await writeProjectFile(page, 'page.html', '<!DOCTYPE html>\n<html>\n<body>\n<p>x</p>\n<script src="app.js"></script>\n<script>\nconsole.log("inline");\nnotDefined();\n</script>\n</body>\n</html>\n');
  await openFile(page, 'page.html');
  await runCommand(page, 'run');
  await expect(consoleLines(page).filter({ hasText: 'inline' })).toHaveCount(1);
  await expect(consoleLines(page).filter({ hasText: 'SyntaxError' })).toContainText('app.js:3');
  await expect(consoleLines(page).filter({ hasText: 'notDefined' })).toContainText('page.html:8');
  await expect(consoleLines(page).filter({ hasText: 'srcdoc' })).toHaveCount(0);
});

test('auto-refresh waits while the file being typed does not parse', async ({ page }) => {
  await boot(page);
  await newProject(page, 'pw', 'web');
  await openFile(page, 'index.html');
  await runCommand(page, 'run');
  await expect(consoleLines(page).filter({ hasText: 'app.js loaded' })).toHaveCount(1);
  await openFile(page, 'app.js');
  const code = await editorText(page);
  await setText(page, `${code}\n/`); // the first "/" of a "//" comment
  await expect(page.locator('.preview-note')).toContainText('app.js:');
  await page.waitForTimeout(300);
  await expect(consoleLines(page).filter({ hasText: 'SyntaxError' })).toHaveCount(0);
  await expect(consoleLines(page).filter({ hasText: 'app.js loaded' })).toHaveCount(1);
  await setText(page, `${code}\n// done\nconsole.log('again');\n`);
  await expect(consoleLines(page).filter({ hasText: 'again' })).toHaveCount(1);
  await expect(page.locator('.preview-note')).toBeHidden();
  await expect(consoleLines(page).filter({ hasText: 'SyntaxError' })).toHaveCount(0);
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

test('Run on a script a page loads (app.js) shows that page — the console has no document', async ({ page }) => {
  await boot(page);
  await newProject(page, 'pg', 'web'); // index.html loads main.js and app.js
  await openFile(page, 'app.js');
  await setText(page, "console.log('app.js loaded');\ndocument.addEventListener('DOMContentLoaded', () => {\n  document.querySelector('h1').textContent = 'From app.js';\n});\n");
  await runCommand(page, 'run');
  const frame = page.frameLocator('iframe.preview-frame');
  await expect(frame.locator('h1')).toHaveText('From app.js');
  await runCommand(page, 'toggleConsole');
  await expect(consoleLines(page).filter({ hasText: 'app.js loaded' })).toHaveCount(1);
  await expect(consoleLines(page).filter({ hasText: 'is not defined' })).toHaveCount(0);
  // a script no page loads still runs in the console — and says why `document` is missing
  await writeProjectFile(page, 'lone.js', "document.title = 'x';\n");
  await openFile(page, 'lone.js');
  await runCommand(page, 'run');
  await expect(page.locator('#console-view .console-line.error')).toContainText('document is not defined');
  await expect(consoleLines(page).filter({ hasText: 'needs a web page' })).toHaveCount(1);
});

test('split code and a side preview: each divider moves only its two neighbours, without a jump', async ({ page, hasTouch }) => {
  await boot(page);
  await newProject(page, 'dv', 'web');
  test.skip(await page.evaluate(() => window.__app.preview.placement() !== 'side'), 'side preview: wide screens');
  await openFile(page, 'index.html');
  await runCommand(page, 'split');
  await runCommand(page, 'run');
  await expect(page.locator('#preview-side iframe')).toBeVisible();
  const w = (sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().width);
  const drag = async (sel, dx) => {
    const d = await page.locator(sel).boundingBox();
    const x = d.x + d.width / 2, y = d.y + d.height / 2;
    if (hasTouch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 6, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y, { steps: 6 });
      await page.mouse.up();
    }
  };
  const [a0, b0, c0] = [await w('#pane-0'), await w('#pane-1'), await w('#preview-side')];
  // a 3 px nudge of the code divider moves it 3 px — no jump
  await drag('#pane-divider', 3);
  expect(Math.abs(await w('#pane-0') - (a0 + 3))).toBeLessThan(2);
  expect(Math.abs(await w('#preview-side') - c0)).toBeLessThan(2);
  // the preview has its own divider: it resizes the preview against the second pane
  await expect(page.locator('#preview-divider')).toBeVisible();
  await drag('#preview-divider', -60);
  expect(Math.abs(await w('#preview-side') - (c0 + 60))).toBeLessThan(3);
  expect(Math.abs(await w('#pane-1') - (b0 - 3 - 60))).toBeLessThan(3);
  expect(Math.abs(await w('#pane-0') - (a0 + 3))).toBeLessThan(2);
});

test('the divider between two code panes follows the finger from where it is (phone: up and down)', async ({ page, hasTouch }) => {
  await boot(page);
  await newProject(page, 'dv2', 'web');
  await openFile(page, 'index.html');
  await runCommand(page, 'split');
  const vertical = await page.evaluate(() => window.__app.layout.compact);
  const size = () => page.locator('#pane-0').evaluate((el, v) => { const r = el.getBoundingClientRect(); return v ? r.height : r.width; }, vertical);
  const s0 = await size();
  const d = await page.locator('#pane-divider').boundingBox();
  const x = d.x + d.width / 2, y = d.y + d.height / 2;
  const to = (k) => (vertical ? { x, y: y + k } : { x: x + k, y });
  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const k of [2, 4, 40]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to(k)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const k of [2, 4, 40]) await page.mouse.move(to(k).x, to(k).y);
    await page.mouse.up();
  }
  expect(Math.abs(await size() - (s0 + 40))).toBeLessThan(2);
});

test('the divider between the code and a side preview: grabbed a little off the line, dragged over the page', async ({ page, hasTouch }) => {
  await boot(page);
  await newProject(page, 'pd', 'web');
  test.skip(await page.evaluate(() => window.__app.preview.placement() !== 'side'), 'side preview: wide screens');
  await runCommand(page, 'run');
  await expect(page.locator('#preview-side')).toBeVisible();
  await expect(page.locator('#preview-side iframe')).toBeVisible();
  const width = () => page.locator('#pane-0').evaluate((el) => el.getBoundingClientRect().width);
  const before = await width();
  const d = await page.locator('#preview-divider').boundingBox();
  // grab 8 px into the preview side (a finger is never exactly on a 5 px line) and pull left
  const x = d.x + d.width + 8, y = d.y + d.height / 2;
  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 15 * i, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 120, y, { steps: 8 });
    await page.mouse.up();
  }
  expect(await width()).toBeLessThan(before - 100);
  // and back to the right, across the preview page
  const after = await width();
  const d2 = await page.locator('#preview-divider').boundingBox();
  await page.mouse.move(d2.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(d2.x + 200, y, { steps: 10 });
  await page.mouse.up();
  expect(await width()).toBeGreaterThan(after + 150);
  await expect(page.locator('body')).not.toHaveClass(/resizing/);
});
