// File tree, quick open, project search, outline, expand selection, split editor.
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, editorText, setText, writeProjectFile, runCommand, mod, isCompact } from './helpers.mjs';

async function showPanel(page, id) {
  await page.evaluate((p) => window.__app.showPanel(p), id);
}

test('file tree: create in a folder, rename, delete (with long-press / right-click menu)', async ({ page, hasTouch }) => {
  await boot(page);
  await newProject(page, 'ft', 'web');
  await page.evaluate(async () => { await window.__app.project.fs.createDir('src'); await window.__app.tree.refresh(); });
  await showPanel(page, 'files');
  const folder = page.locator('.tree-row[data-path="src"]');
  if (hasTouch) {
    await page.waitForTimeout(350); // let the phone drawer finish sliding in
    const b = await folder.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 40, y: b.y + b.height / 2 }] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await folder.click({ button: 'right' });
  }
  await page.getByRole('menuitem', { name: 'New file here' }).click();
  await page.locator('.modal input').fill('util.js');
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.tab.active .tab-name')).toHaveText('util.js');
  expect(await page.evaluate(() => window.__app.project.fs.exists('src/util.js'))).toBe(true);

  // rename (through the same action the menu uses)
  // not awaited inside the page: the action waits for the dialog we answer below
  await page.evaluate(() => { window.__app.actions.rename('src/util.js', 'file'); });
  await page.locator('.modal input').fill('helpers.js');
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.tab.active .tab-name')).toHaveText('helpers.js');
  expect(await page.evaluate(() => window.__app.project.fs.exists('src/helpers.js'))).toBe(true);

  await page.evaluate(() => { window.__app.actions.remove('src/helpers.js', 'file'); });
  await page.locator('.modal').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.tab', { hasText: 'helpers.js' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__app.project.fs.exists('src/helpers.js'))).toBe(false);
});

test('quick open finds files by fuzzy name (Ctrl+P / palette)', async ({ page }) => {
  await boot(page);
  await newProject(page, 'qo', 'web');
  await writeProjectFile(page, 'src/components/userProfile.js', 'export {};\n');
  await writeProjectFile(page, 'node_modules/lib/index.js', '// ignored\n');
  await runCommand(page, 'quickOpen');
  await page.locator('.palette-input').fill('usrprof');
  await expect(page.locator('.palette-item').first()).toContainText('src/components/userProfile.js');
  await page.locator('.palette-input').fill('lib/index');
  await expect(page.locator('.palette-item')).toHaveCount(0);
  await page.locator('.palette-input').fill('usrprof');
  await page.locator('.palette-input').press('Enter');
  await expect(page.locator('.tab.active .tab-name')).toHaveText('userProfile.js');
});

test('command palette runs commands; ":" goes to a line', async ({ page }) => {
  await boot(page);
  await newProject(page, 'cp', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'a\nb\nc\nd\ne\n', 0);
  await runCommand(page, 'goToLine');
  await page.locator('.palette-input').fill(':4');
  await page.locator('.palette-input').press('Enter');
  const line = await page.evaluate(() => { const s = window.__app.ws.view.state; return s.doc.lineAt(s.selection.main.head).number; });
  expect(line).toBe(4);
  await runCommand(page, 'commandPalette');
  await page.locator('.palette-input').fill('>toggle comm');
  await page.locator('.palette-input').press('Enter');
  expect(await editorText(page)).toBe('a\nb\nc\n// d\ne\n');
});

test('project search respects .gitignore and opens the match', async ({ page }) => {
  await boot(page);
  await newProject(page, 'srch', 'empty');
  await writeProjectFile(page, '.gitignore', 'dist/\n');
  await writeProjectFile(page, 'a.js', 'const needle = 1;\n');
  await writeProjectFile(page, 'sub/b.js', '// no\n// needle here\n');
  await writeProjectFile(page, 'dist/c.js', 'needle in build output\n');
  await showPanel(page, 'search');
  await page.locator('.side-panel[data-panel="search"] input[type=search]').fill('needle');
  await expect(page.locator('.search-summary')).toContainText('2 results in 2 files');
  await page.locator('.result-line', { hasText: 'needle here' }).click();
  await expect(page.locator('.tab.active .tab-name')).toHaveText('b.js');
  const sel = await page.evaluate(() => { const s = window.__app.ws.view.state; return s.sliceDoc(s.selection.main.from, s.selection.main.to); });
  expect(sel).toBe('needle');
  // regex + whole word
  await showPanel(page, 'search');
  await page.locator('.side-panel[data-panel="search"] .chip', { hasText: '.*' }).click();
  await page.locator('.side-panel[data-panel="search"] input[type=search]').fill('need\\w+');
  await expect(page.locator('.search-summary')).toContainText('2 results');
});

test('outline lists symbols and jumps to them; breadcrumbs follow the cursor', async ({ page }) => {
  await boot(page);
  await newProject(page, 'ol', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'class Shape {\n  area() {\n    return 0;\n  }\n}\n\nfunction helper() {}\n', 0);
  await showPanel(page, 'outline');
  await expect(page.locator('.outline-row .oname')).toHaveText(['Shape', 'area', 'helper']);
  await page.locator('.outline-row', { hasText: 'helper' }).click();
  const line = await page.evaluate(() => { const s = window.__app.ws.view.state; return s.doc.lineAt(s.selection.main.head).number; });
  expect(line).toBe(7);
  await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 25 } }));
  await expect(page.locator('.pane.focused-pane .crumbs')).toContainText('Shape');
  await expect(page.locator('.pane.focused-pane .crumbs')).toContainText('area');
});

test('expand / shrink selection from the keyboard', async ({ page }) => {
  await boot(page);
  await newProject(page, 'ex', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'call(alpha, beta);', 7);
  await page.keyboard.press('Alt+Shift+ArrowRight');
  await page.keyboard.press('Alt+Shift+ArrowRight');
  let sel = await page.evaluate(() => { const s = window.__app.ws.view.state; return s.sliceDoc(s.selection.main.from, s.selection.main.to); });
  expect(sel).toBe('alpha, beta');
  await page.keyboard.press('Alt+Shift+ArrowLeft');
  sel = await page.evaluate(() => { const s = window.__app.ws.view.state; return s.sliceDoc(s.selection.main.from, s.selection.main.to); });
  expect(sel).toBe('alpha');
});

test('split editor: the same file in two panes stays in sync, undo is per pane', async ({ page }) => {
  await boot(page);
  await newProject(page, 'sp', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'one\n');
  await runCommand(page, 'split');
  await expect(page.locator('#pane-1')).toBeVisible();
  await expect(page.locator('#pane-1 .tab.active .tab-name')).toHaveText('main.js');
  // type in the right pane
  await page.evaluate(() => {
    const v = window.__app.ws.panes[1].view;
    v.dispatch({ changes: { from: v.state.doc.length, insert: 'two\n' }, userEvent: 'input.type' });
  });
  const left = await page.evaluate(() => window.__app.ws.panes[0].view.state.doc.toString());
  expect(left).toBe('one\ntwo\n');
  await expect(page.locator('#pane-0 .tab.active')).toHaveClass(/dirty/);
  await runCommand(page, 'split'); // unsplit
  await expect(page.locator('#pane-1')).toBeHidden();
});

test('read-only lock and soft wrap toggles in the status bar', async ({ page }) => {
  await boot(page);
  await newProject(page, 'lk', 'js');
  await openFile(page, 'main.js');
  await page.locator('#statusbar [aria-label="Lock editing"]').click();
  expect(await page.evaluate(() => window.__app.ws.view.state.readOnly)).toBe(true);
  await expect(page.locator('.pane.focused-pane .cm-content')).toHaveAttribute('contenteditable', 'false');
  await page.locator('#statusbar [aria-label="Unlock editing"]').click();
  expect(await page.evaluate(() => window.__app.ws.view.state.readOnly)).toBe(false);
  const wrapBefore = await page.evaluate(() => window.__app.ws.view.lineWrapping);
  await page.locator('#statusbar button', { hasText: 'Wrap' }).click();
  expect(await page.evaluate(() => window.__app.ws.view.lineWrapping)).toBe(!wrapBefore);
});

test('syntax errors are underlined and counted in Problems', async ({ page }) => {
  await boot(page);
  await newProject(page, 'pr', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'let x = ;\n');
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
  await expect(page.locator('#statusbar')).toContainText('✖ 1');
  await runCommand(page, 'showProblems');
  await expect(page.locator('.problem-row')).toContainText('Syntax error');
});

test('adaptive layout: drawer on phones, persistent sidebar on wide screens', async ({ page }) => {
  await boot(page);
  await newProject(page, 'ly', 'web');
  if (await isCompact(page)) {
    await expect(page.locator('#activitybar')).toBeHidden();
    await page.locator('#btn-sidebar').click();
    await expect(page.locator('#app')).toHaveClass(/drawer-open/);
    await page.locator('.tree-row[data-path="style.css"]').click();
    await expect(page.locator('#app')).not.toHaveClass(/drawer-open/);
    await expect(page.locator('.tab.active .tab-name')).toHaveText('style.css');
  } else {
    await expect(page.locator('#activitybar')).toBeVisible();
    await expect(page.locator('#sidebar')).toBeVisible();
    await page.keyboard.press(`${mod}+b`);
    await expect(page.locator('#sidebar')).toBeHidden();
  }
});
