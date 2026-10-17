// ROADMAP Phase 3 — look & feel: themes, the status bar by state, bracket
// pair colours and indent guides, Codicons and file-type icons, long-press
// tooltips, interaction states, no text selection on the interface, reduced
// motion, project actions (rename…), Zen mode, fullscreen, the title bar
// sliding away, the welcome screen.
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, setText, runCommand, longPress, swipe, codePoint, mod } from './helpers.mjs';

const BLUE = 'rgb(0, 120, 212)';
const PURPLE = 'rgb(104, 33, 122)';
const ORANGE = 'rgb(204, 102, 51)';
const statusBg = (page) => page.locator('#statusbar').evaluate((el) => getComputedStyle(el).backgroundColor);
const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

// ---- themes & status bar -------------------------------------------------------------------

test('four themes; dark-based ones also carry theme-dark; the picker switches them', async ({ page }) => {
  await boot(page, { theme: 'hc' }); // also from the very first paint
  expect(await cssVar(page, '--bg')).toBe('#000000');
  for (const [theme, classes, bg] of [
    ['dark', ['theme-dark'], '#1f1f1f'],
    ['light', ['theme-light'], '#ffffff'],
    ['hc', ['theme-dark', 'theme-hc'], '#000000'],
    ['monokai', ['theme-dark', 'theme-monokai'], '#272822'],
  ]) {
    await page.evaluate((t) => window.__app.updateSettings({ theme: t }), theme);
    const cls = await page.evaluate(() => [...document.documentElement.classList].filter((c) => c.startsWith('theme-')).sort());
    expect(cls).toEqual([...classes].sort());
    expect(await cssVar(page, '--bg')).toBe(bg);
  }
  await page.evaluate(() => window.__app.updateSettings({ theme: 'dark' }));
  await page.evaluate(() => { window.__app.pickTheme(); });
  await page.locator('.palette').getByText('Monokai', { exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/theme-monokai/);
  expect(await page.evaluate(() => window.__app.settings.theme)).toBe('monokai');
});

test('status bar: purple with no project, blue with one, orange while code runs', async ({ page }) => {
  await boot(page);
  await expect.poll(() => statusBg(page)).toBe(PURPLE);
  await newProject(page, 'sb', 'js');
  await expect.poll(() => statusBg(page)).toBe(BLUE);
  await openFile(page, 'main.js');
  await setText(page, 'const t = Date.now();\nwhile (Date.now() - t < 1500) {}\nconsole.log("done");\n');
  await runCommand(page, 'run');
  await expect.poll(() => statusBg(page)).toBe(ORANGE);
  await expect(page.locator('#statusbar')).toHaveClass(/sb-running/);
  await expect.poll(() => statusBg(page), { timeout: 10000 }).toBe(BLUE);
});

test('git status colours the names in the file tree (folders holding changes too)', async ({ page }) => {
  await boot(page);
  await newProject(page, 'gitc', 'web');
  await page.evaluate(async () => {
    const app = window.__app;
    await app.project.fs.createDir('lib');
    await app.project.fs.writeBytes('lib/util.js', new TextEncoder().encode('x'));
    await app.tree.refresh();
    app.tree.expanded.add('lib');
    await app.tree.render();
    app.gitBadges = new Map([['index.html', 'M'], ['lib/util.js', 'U']]);
    app.tree.decorate();
  });
  const color = (path) => page.locator(`.tree-row[data-path="${path}"] .tname`).evaluate((el) => getComputedStyle(el).color);
  const hex = (rgb) => '#' + rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  expect(hex(await color('index.html'))).toBe(await cssVar(page, '--git-modified'));
  expect(hex(await color('lib/util.js'))).toBe(await cssVar(page, '--git-untracked'));
  expect(hex(await color('lib'))).toBe(await cssVar(page, '--git-modified'));
  await expect(page.locator('.tree-row[data-path="index.html"] .tbadge')).toHaveText('M');
});

// ---- editor: brackets & guides -------------------------------------------------------------

test('bracket pairs are coloured by depth; a stray closer is red; the setting turns it off', async ({ page }) => {
  await boot(page);
  await newProject(page, 'bp', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'f(a[b{c}]);\nx = "(";\n)');
  const levels = () => page.locator('.cm-content .cm-bp').evaluateAll((els) => els.map((e) => `${e.textContent}${e.className.match(/cm-bp(\d|-bad)/)[1]}`).join(' '));
  await expect.poll(levels).toBe('(0 [1 {2 }2 ]1 )0 )-bad');
  const c = await page.locator('.cm-content .cm-bp0').first().evaluate((el) => getComputedStyle(el.firstElementChild || el).color);
  expect(c).toBe('rgb(255, 215, 0)'); // VS Code's first bracket colour
  // Letters typed only shift the marks; a full recount follows when typing
  // pauses: in "retur /[/]/" the [ is code (a division), in "return /[/]/" part of a regex.
  await setText(page, 'f(1);\nretur /[/]/;');
  await expect.poll(levels).toBe('(0 )0 [0');
  await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ changes: { from: 11, insert: 'n' }, userEvent: 'input.type' }); });
  await expect.poll(levels).toBe('(0 )0');
  await page.evaluate(() => window.__app.updateSettings({ bracketPairColors: false }));
  await expect(page.locator('.cm-content .cm-bp')).toHaveCount(0);
});

test('indent guides: one per level, blank lines inside a block keep them; the setting turns them off', async ({ page }) => {
  await boot(page);
  await newProject(page, 'ig', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'if (a) {\n  if (b) {\n    c();\n\n    d();\n  }\n}\n');
  const counts = () => page.locator('.cm-content .cm-line').evaluateAll((els) => els.map((e) => (e.classList.contains('cm-ig') ? Number(e.style.getPropertyValue('--ig-n')) : 0)));
  await expect.poll(counts).toEqual([0, 1, 2, 2, 2, 1, 0, 0]);
  // a letter on the blank line: no longer blank, so it gets its own (zero) guides
  await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ changes: { from: v.state.doc.line(4).from, insert: 'x' }, userEvent: 'input.type' }); });
  await expect.poll(counts).toEqual([0, 1, 2, 0, 2, 1, 0, 0]);
  // a letter inside a line keeps every guide
  await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ changes: { from: v.state.doc.line(3).to - 1, insert: 'y' }, userEvent: 'input.type' }); });
  await expect.poll(counts).toEqual([0, 1, 2, 0, 2, 1, 0, 0]);
  await page.evaluate(() => window.__app.updateSettings({ indentGuides: false }));
  await expect(page.locator('.cm-content .cm-ig')).toHaveCount(0);
});

// ---- icons -----------------------------------------------------------------------------------

test('Codicons in the interface; Material icons by file type and folder name in the tree and tabs', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#btn-save svg')).toHaveAttribute('viewBox', '0 0 16 16');
  await newProject(page, 'icons', 'web');
  await page.evaluate(async () => {
    const fs = window.__app.project.fs;
    await fs.createDir('src');
    await fs.writeBytes('src/app.ts', new TextEncoder().encode('let a = 1;'));
    await fs.writeBytes('package.json', new TextEncoder().encode('{}'));
    await window.__app.tree.refresh();
  });
  await expect(page.locator('.tree-row[data-path="index.html"] .file-icon')).toHaveAttribute('data-icon', 'html');
  await expect(page.locator('.tree-row[data-path="package.json"] .file-icon')).toHaveAttribute('data-icon', 'nodejs');
  await expect(page.locator('.tree-row[data-path="src"] .file-icon')).toHaveAttribute('data-icon', 'folder-src');
  await page.evaluate(async () => { window.__app.tree.expanded.add('src'); await window.__app.tree.render(); window.__app.tree.decorate(); });
  await expect(page.locator('.tree-row[data-path="src"] .file-icon')).toHaveAttribute('data-icon', 'folder-src-open');
  await expect(page.locator('.tree-row[data-path="src/app.ts"] .file-icon')).toHaveAttribute('data-icon', 'typescript');
  await openFile(page, 'index.html');
  await expect(page.locator('.pane.focused-pane .tab.active .file-icon')).toHaveAttribute('data-icon', 'html');
});

test('About lists the icon credits (CC BY 4.0, MIT)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__app.openSettings('about'));
  const credits = page.locator('.settings-view .credits');
  await expect(credits).toContainText('Codicons');
  await expect(credits).toContainText('CC BY 4.0');
  await expect(credits).toContainText('Material Icon Theme');
});

// ---- touch: tooltips & interaction ---------------------------------------------------------------

test('long-press an icon: its name in a bubble, and the button does not fire', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch');
  await boot(page);
  await newProject(page, 'tip', 'js');
  await longPress(page, page.locator('#btn-palette'));
  await expect(page.locator('.tip')).toHaveText(/Command palette/);
  await expect(page.locator('.palette')).toBeHidden();
  await expect(page.locator('.tip')).toHaveCount(0, { timeout: 4000 }); // fades on its own
  // a short tap still works
  await page.locator('#btn-palette').tap();
  await expect(page.locator('.palette')).toBeVisible();
});

test('a mouse resting on an icon shows its name — on Android, whose browsers never show a title (desktop: the browser does)', async ({ page, isMobile }) => {
  await boot(page);
  await newProject(page, 'tip3', 'js');
  const btn = page.locator('#btn-palette');
  await btn.click({ trial: true });
  const b = await btn.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  if (!isMobile) {
    await page.waitForTimeout(800);
    await expect(page.locator('.tip')).toHaveCount(0); // the browser's own tooltip, not a second one
    return;
  }
  await expect(page.locator('.tip')).toHaveText(/Command palette/);
  // moving away hides it; a click still works and leaves no bubble
  await page.mouse.move(b.x + b.width / 2, b.y + 300);
  await expect(page.locator('.tip')).toHaveCount(0);
  await btn.click();
  await expect(page.locator('.palette')).toBeVisible();
  await expect(page.locator('.tip')).toHaveCount(0);
});

test('long-press keeps its own meaning on tree rows and keys (no tooltip there)', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch');
  await boot(page);
  await newProject(page, 'tip2', 'js');
  if (await page.evaluate(() => window.__app.layout.compact)) await page.evaluate(() => window.__app.showPanel('files'));
  await longPress(page, page.locator('.tree-row[data-path="main.js"]'));
  await expect(page.locator('.popup-menu')).toBeVisible();
  await expect(page.locator('.tip')).toHaveCount(0);
});

test('the interface is not selectable text; code, console output and messages are', async ({ page }) => {
  await boot(page);
  await page.locator('.welcome h1').first().dblclick();
  expect(await page.evaluate(() => String(getSelection()))).toBe('');
  for (const sel of ['#titlebar', '#statusbar', '.welcome']) {
    expect(await page.locator(sel).first().evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
  }
  await newProject(page, 'sel', 'js');
  expect(await page.locator('.cm-content').first().evaluate((el) => getComputedStyle(el).userSelect)).toBe('text');
  expect(await page.locator('.console-lines').evaluate((el) => getComputedStyle(el).userSelect)).toBe('text');
});

test('reduced motion: entrance animations become instant', async ({ page }) => {
  await boot(page);
  const dur = () => page.locator('.welcome > *').first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(await dur()).toBe('0.24s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await dur()).toBe('0.001s');
});

// ---- project actions -------------------------------------------------------------------------

async function openProjectMenu(page, hasTouch) {
  if (hasTouch) await longPress(page, page.locator('#btn-project'));
  else await page.locator('#btn-project').click({ button: 'right' });
  await expect(page.locator('.popup-menu')).toBeVisible();
}

test('project name: tap = switch project; hold / right-click = project actions (armed while open)', async ({ page, hasTouch }) => {
  await boot(page);
  await newProject(page, 'pm', 'js');
  await page.locator('#btn-project').click();
  await expect(page.locator('.modal')).toContainText('Recent projects');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  await openProjectMenu(page, hasTouch);
  await expect(page.locator('.modal')).toHaveCount(0); // no switch dialog behind the menu
  for (const item of ['Rename project…', 'Switch project…', 'New project…', 'Export project as .zip', 'Close project', 'Delete project…']) {
    await expect(page.locator('.popup-menu')).toContainText(item);
  }
  await expect(page.locator('#btn-project')).toHaveClass(/armed/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-project')).not.toHaveClass(/armed/);
});

test('rename a project: the name changes everywhere and survives a reload; files stay', async ({ page, hasTouch }) => {
  await boot(page);
  await newProject(page, 'before', 'js');
  await openProjectMenu(page, hasTouch);
  await page.locator('.popup-menu').getByText('Rename project…').click();
  await page.locator('.modal input.input').fill('after');
  await page.locator('.modal').getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('#project-name')).toHaveText('after');
  await expect(page.locator('#files-title')).toHaveText('after');
  await page.reload();
  await page.waitForFunction(() => !!window.__app && window.__app.project);
  await expect(page.locator('#project-name')).toHaveText('after');
  expect(await page.evaluate(async () => !!(await window.__app.project.fs.stat('main.js')))).toBe(true);
  await page.locator('#btn-project').click();
  const names = page.locator('.modal .project-row .pr-name');
  await expect(names.filter({ hasText: /^after$/ })).toHaveCount(1);
  await expect(names.filter({ hasText: /^before$/ })).toHaveCount(0);
});

test('rename refuses a name another project has; a new project cannot reuse a renamed one\'s folder', async ({ page }) => {
  await boot(page);
  await newProject(page, 'one', 'empty');
  await page.evaluate(() => window.__app.closeProject());
  await newProject(page, 'two', 'empty');
  await page.evaluate(() => { window.__app.renameCurrentProject(); });
  await page.locator('.modal input.input').fill('one');
  await page.locator('.modal').getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('.toast')).toContainText('already called "one"');
  await expect(page.locator('#project-name')).toHaveText('two');
  await page.evaluate(() => { window.__app.renameCurrentProject(); });
  await page.locator('.modal input.input').fill('three');
  await page.locator('.modal').getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('#project-name')).toHaveText('three');
  // "two" is still the folder of "three": a new "two" would collide with it
  await page.evaluate(() => { window.__app.newBrowserProject(); });
  await page.locator('.modal input.input').fill('two');
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Empty' }).click();
  await expect(page.locator('.toast').last()).toContainText('renamed project');
  await expect(page.locator('#project-name')).toHaveText('three');
});

test('close and delete from the project menu', async ({ page, hasTouch }) => {
  await boot(page);
  await newProject(page, 'gone', 'js');
  await openProjectMenu(page, hasTouch);
  await page.locator('.popup-menu').getByText('Close project').click();
  await expect(page.locator('#project-name')).toHaveText('No project');
  await expect.poll(() => statusBg(page)).toBe(PURPLE);
  await page.locator('.project-row', { hasText: 'gone' }).locator('.pr-main').click();
  await expect(page.locator('#project-name')).toHaveText('gone');
  await openProjectMenu(page, hasTouch);
  await page.locator('.popup-menu').getByText('Delete project…').click();
  await page.locator('.modal').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('#project-name')).toHaveText('No project');
  await expect(page.locator('.project-row', { hasText: 'gone' })).toHaveCount(0);
});

// ---- view modes ------------------------------------------------------------------------------

test('Zen mode: only the code (and keys bar); Esc Esc or the corner button leaves', async ({ page, hasTouch }) => {
  await boot(page);
  await newProject(page, 'zen', 'js');
  await openFile(page, 'main.js');
  await runCommand(page, 'toggleZen');
  await expect(page.locator('#app')).toHaveClass(/zen/);
  for (const sel of ['#titlebar', '#statusbar', '.pane.focused-pane .tab-bar', '#activitybar']) await expect(page.locator(sel)).toBeHidden();
  await expect(page.locator('.pane.focused-pane .cm-editor')).toBeVisible();
  await page.locator('#zen-exit').click();
  await expect(page.locator('#app')).not.toHaveClass(/zen/);
  await expect(page.locator('#titlebar')).toBeVisible();
  if (!hasTouch) {
    await page.keyboard.press(`${mod === 'Meta' ? 'Meta' : 'Control'}+Alt+z`);
    await expect(page.locator('#app')).toHaveClass(/zen/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('#app')).not.toHaveClass(/zen/);
  }
});

test('fullscreen button (wide screens): on, then off', async ({ page }) => {
  await boot(page);
  test.skip(await page.evaluate(() => window.__app.layout.compact), 'wide screens');
  await page.locator('#btn-fullscreen').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.locator('#btn-fullscreen')).toHaveClass(/active/);
  await page.locator('#btn-fullscreen').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test('phone: the title bar slides away while scrolling the code down, back when scrolling up', async ({ page }) => {
  await boot(page);
  test.skip(!(await page.evaluate(() => window.__app.layout.compact)), 'phone');
  await newProject(page, 'scroll', 'js');
  await openFile(page, 'main.js');
  await setText(page, Array.from({ length: 300 }, (_, i) => `const line${i} = ${i};`).join('\n'), 0);
  await page.evaluate(() => window.__app.ws.view.contentDOM.blur());
  // the editor following the cursor is not the owner scrolling: the bar stays
  await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true }); });
  await page.waitForTimeout(300);
  await expect(page.locator('#app')).not.toHaveClass(/title-hidden/);
  await page.evaluate(() => { window.__app.ws.view.scrollDOM.scrollTop = 0; });
  const a = await codePoint(page, 0.5, 0.7);
  const b = await codePoint(page, 0.5, 0.2);
  await swipe(page, { from: { x: a.x + 30, y: a.y }, to: { x: a.x + 30, y: b.y }, duration: 300, steps: 10 });
  await expect(page.locator('#app')).toHaveClass(/title-hidden/);
  await swipe(page, { from: { x: a.x + 30, y: b.y }, to: { x: a.x + 30, y: a.y }, duration: 300, steps: 10 });
  await expect(page.locator('#app')).not.toHaveClass(/title-hidden/);
});

test('welcome: logo, start cards, recent projects with icons, theme button', async ({ page }) => {
  await boot(page);
  await newProject(page, 'w', 'empty');
  await page.evaluate(() => window.__app.closeProject());
  const w = page.locator('#pane-0 .welcome');
  await expect(w.locator('.welcome-logo')).toBeVisible();
  await expect(w.locator('.action-card').first()).toContainText('New project');
  await expect(w.locator('.project-row', { hasText: 'w' }).locator('.pr-icon svg')).toBeVisible();
  await w.getByRole('button', { name: /^Theme:/ }).click();
  await expect(page.locator('.palette')).toBeVisible();
});
