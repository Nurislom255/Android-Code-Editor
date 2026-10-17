// ROADMAP Phase 4 — tabs and the file explorer. These were the phase's
// acceptance tests (written ahead as test.fixme); each title is a
// requirement.
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, writeProjectFile, longPress, dragItem } from './helpers.mjs';

const row = (page, p) => page.locator(`.tree-row[data-path="${p}"]`);
const tabNames = (page, pane = 0) => page.locator(`#pane-${pane} .tab .tab-name`).allTextContents();
const exists = (page, p) => page.evaluate((x) => window.__app.project.fs.exists(x), p);
const compact = (page) => page.evaluate(() => window.__app.layout.compact);

/** The Files panel, ready to tap (the phone's drawer finished sliding in). */
async function files(page) {
  await page.evaluate(() => window.__app.showPanel('files'));
  if (await compact(page)) await page.waitForTimeout(350);
}

/** A row's long-press menu (touch) or right-click menu (mouse). */
async function rowMenu(page, hasTouch, path) {
  await files(page);
  if (hasTouch) await longPress(page, row(page, path).locator('.tname'));
  else await row(page, path).click({ button: 'right' });
  await expect(page.locator('.popup-menu')).toBeVisible();
}

async function project(page, settings = {}) {
  await boot(page, settings);
  await newProject(page, 'p4', 'web'); // index.html, style.css, main.js
  await page.evaluate(() => window.__app.ws.closeAll({ force: true }));
}

// ---- tabs ---------------------------------------------------------------------------------

test('tabs: dragging a tab to the right (or bottom) edge shows a drop zone and splits', async ({ page, hasTouch }) => {
  await project(page);
  await openFile(page, 'index.html');
  await openFile(page, 'style.css');
  const tab = page.locator('#pane-0 .tab', { hasText: 'style.css' });
  const phone = await compact(page);
  // during the drag, over that half of the code: the drop zone
  const b = await tab.boundingBox();
  const area = await page.locator('#editor-area').boundingBox();
  const to = phone ? { x: area.x + area.width / 2, y: area.y + area.height * 0.8 } : { x: area.x + area.width * 0.8, y: area.y + area.height / 2 };
  const x0 = b.x + 20, y0 = b.y + b.height / 2;
  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    await page.waitForTimeout(650);
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((to.x - x0) * i) / 10, y: y0 + ((to.y - y0) * i) / 10 }] });
    await expect(page.locator('.split-drop')).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.locator('.split-drop')).toBeVisible();
    await page.mouse.up();
  }
  await expect(page.locator('#app')).toHaveClass(/split/);
  await expect.poll(() => tabNames(page, 1)).toEqual(['style.css']);
  expect(await tabNames(page, 0)).toEqual(['index.html']);
  await expect(page.locator('.split-drop')).toBeHidden();
});

test('tabs: preview tabs — a single tap opens an italic temporary tab, editing keeps it', async ({ page }) => {
  await project(page);
  await files(page);
  await row(page, 'index.html').click();
  await expect(page.locator('#pane-0 .tab.preview .tab-name')).toHaveText('index.html');
  await files(page);
  await row(page, 'style.css').click(); // replaces the preview tab
  await expect.poll(() => tabNames(page)).toEqual(['style.css']);
  await expect(page.locator('#pane-0 .tab.preview')).toHaveCount(1);
  // typing keeps it: the next file gets its own tab
  await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ changes: { from: 0, insert: '/* x */' }, userEvent: 'input.type' }); });
  await expect(page.locator('#pane-0 .tab.preview')).toHaveCount(0);
  await files(page);
  await row(page, 'main.js').click();
  await expect.poll(() => tabNames(page)).toEqual(['style.css', 'main.js']);
  // a double-tap on its tab keeps it too
  const tab = page.locator('#pane-0 .tab', { hasText: 'main.js' });
  await expect(tab).toHaveClass(/preview/);
  await tab.click();
  await tab.click();
  await expect(tab).not.toHaveClass(/preview/);
  // and a double-tap in the tree opens it for good (wide screens: on a phone
  // the first tap already closes the drawer — double-tap the tab there)
  if (!(await compact(page))) {
    await row(page, 'index.html').click();
    await row(page, 'index.html').click();
    await expect(page.locator('#pane-0 .tab', { hasText: 'index.html' })).not.toHaveClass(/preview/);
  }
});

test('a long-press menu never acts by itself when the finger lifts (it opens clear of the finger)', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch');
  await project(page, { compactFolders: false });
  for (let i = 0; i < 12; i++) await writeProjectFile(page, `z${String(i).padStart(2, '0')}.txt`, 'x');
  await page.evaluate(() => window.__app.tree.refresh());
  await files(page);
  // the last row: the menu has to open above the finger
  const last = row(page, 'z11.txt');
  await last.scrollIntoViewIfNeeded();
  await longPress(page, last.locator('.tname'));
  await expect(page.locator('.popup-menu')).toBeVisible(); // still open: no item was tapped by the lift
  expect(await exists(page, 'z11.txt')).toBe(true);
  const m = await page.locator('.popup-menu').boundingBox();
  const r = await last.boundingBox();
  const finger = r.y + r.height / 2;
  expect(finger < m.y || finger > m.y + m.height).toBe(true); // not under the finger
});

// ---- explorer -------------------------------------------------------------------------------

test('explorer: the tapped folder is the target for New File / New Folder', async ({ page }) => {
  await project(page);
  await writeProjectFile(page, 'src/a.js', 'a');
  await writeProjectFile(page, 'docs/readme.md', '#');
  await page.evaluate(() => window.__app.tree.refresh());
  await files(page);
  // a folder tapped → new file inside it, named in the tree
  await row(page, 'src').click();
  await page.locator('.side-panel[data-panel="files"] .panel-header').getByRole('button', { name: 'New file' }).click();
  const input = page.locator('.tree-edit input');
  await expect(input).toBeVisible();
  await input.fill('x.js');
  await input.press('Enter');
  await expect.poll(() => exists(page, 'src/x.js')).toBe(true);
  await expect(page.locator('.pane.focused-pane .tab.active')).toHaveAttribute('title', 'src/x.js');
  // a file tapped → its folder
  await files(page);
  await row(page, 'src/a.js').click();
  await files(page);
  await page.locator('.side-panel[data-panel="files"] .panel-header').getByRole('button', { name: 'New folder' }).click();
  await page.locator('.tree-edit input').fill('lib');
  await page.locator('.tree-edit input').press('Enter');
  await expect.poll(() => exists(page, 'src/lib')).toBe(true);
  // nothing selected → the project root
  await page.evaluate(() => { window.__app.tree.clearSelection(); window.__app.tree.focus = null; });
  await files(page);
  await page.locator('.side-panel[data-panel="files"] .panel-header').getByRole('button', { name: 'New file' }).click();
  await page.locator('.tree-edit input').fill('root.txt');
  await page.locator('.tree-edit input').press('Enter');
  await expect.poll(() => exists(page, 'root.txt')).toBe(true);
});

test('explorer: create and rename inline in the tree, no dialog', async ({ page, hasTouch }) => {
  await project(page);
  await openFile(page, 'main.js');
  await rowMenu(page, hasTouch, 'main.js');
  await page.getByRole('menuitem', { name: /^Rename/ }).click();
  const input = page.locator('.tree-edit input');
  await expect(input).toBeVisible();
  await expect(page.locator('.modal')).toHaveCount(0);
  // the name without the extension is selected, ready to type over
  expect(await input.evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([0, 'main'.length]);
  // an invalid name: said in place, still editing
  await input.fill('a:b.js');
  await input.press('Enter');
  await expect(page.locator('.tree-edit-error')).not.toBeEmpty();
  await expect(input).toBeVisible();
  await input.fill('renamed.js');
  await input.press('Enter');
  await expect.poll(() => exists(page, 'renamed.js')).toBe(true);
  expect(await exists(page, 'main.js')).toBe(false);
  await expect(page.locator('#pane-0 .tab .tab-name')).toHaveText(['renamed.js']); // the open tab follows
  // Esc cancels a new file
  await page.evaluate(() => { window.__app.actions.newFile(''); });
  await page.locator('.tree-edit input').fill('nope.js');
  await page.locator('.tree-edit input').press('Escape');
  await expect(page.locator('.tree-edit')).toHaveCount(0);
  expect(await exists(page, 'nope.js')).toBe(false);
});

test('explorer: folders open while dragging over them; "Moved …" can be undone', async ({ page, hasTouch }) => {
  await project(page, { compactFolders: false });
  await writeProjectFile(page, 'lib/inner.js', 'x');
  await page.evaluate(() => window.__app.tree.refresh());
  await files(page);
  await expect(row(page, 'lib')).not.toHaveClass(/open/);
  const a = await row(page, 'style.css').boundingBox();
  const f = await row(page, 'lib').boundingBox();
  const x0 = a.x + 40, y0 = a.y + a.height / 2, x1 = f.x + 60, y1 = f.y + f.height / 2;
  let cdp;
  if (hasTouch) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    await page.waitForTimeout(650);
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8 }] });
  } else {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
  }
  // held over the closed folder: it opens, under the finger, without ending the drag
  await expect(row(page, 'lib/inner.js')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.drag-lift')).toBeVisible();
  if (hasTouch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); }
  else await page.mouse.up();
  await expect.poll(() => exists(page, 'lib/style.css')).toBe(true);
  const toast = page.locator('.toast', { hasText: 'Moved style.css' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => exists(page, 'style.css')).toBe(true);
  expect(await exists(page, 'lib/style.css')).toBe(false);
});

// ---- reordering: the item lifts, the others slide aside -----------------------------------

/** Paths of the tree rows as they stand now (mid-drag: where the empty slot is). */
const rowPaths = (page) => page.evaluate(() => [...document.querySelectorAll('.tree-rows > .tree-row:not(.drag-hidden)')].map((r) => r.dataset.path));

test('explorer: a file dragged between two others stays there (after a reload too); folders stay on top; Sort A–Z', async ({ page, hasTouch }) => {
  await project(page, { compactFolders: false });
  await writeProjectFile(page, 'lib/inner.js', 'x');
  await page.evaluate(() => window.__app.tree.refresh());
  await files(page);
  expect(await rowPaths(page)).toEqual(['lib', 'app.js', 'index.html', 'main.js', 'style.css']);
  // onto the upper half of index.html: while it is held, its empty slot is already there
  await dragItem(page, hasTouch, row(page, 'style.css'), row(page, 'index.html'), { x: 0.5, y: 0.3 }, {
    during: async () => {
      await expect.poll(() => rowPaths(page)).toEqual(['lib', 'app.js', 'style.css', 'index.html', 'main.js']);
      await expect(row(page, 'style.css')).toHaveClass(/drag-origin/);
    },
  });
  await expect.poll(() => page.evaluate(() => window.__app.tree.order())).toEqual(['lib', 'app.js', 'style.css', 'index.html', 'main.js']);
  await expect(page.locator('.drag-lift')).toHaveCount(0);
  expect(await exists(page, 'style.css')).toBe(true); // reordered, not moved

  // the order is kept per project
  await page.evaluate(() => window.__app.orderSaved);
  await page.reload();
  await page.waitForFunction(() => window.__app && window.__app.project);
  await files(page);
  await expect.poll(() => rowPaths(page)).toEqual(['lib', 'app.js', 'style.css', 'index.html', 'main.js']);

  // a file let go above a folder lands at the top of the files: folders stay on top
  await dragItem(page, hasTouch, row(page, 'main.js'), row(page, 'lib'), { x: 0.5, y: 0.1 }, {
    during: () => expect.poll(() => rowPaths(page)).toEqual(['lib', 'main.js', 'app.js', 'style.css', 'index.html']),
  });
  await expect.poll(() => rowPaths(page)).toEqual(['lib', 'main.js', 'app.js', 'style.css', 'index.html']);

  // the middle of a folder still means "into it"
  await dragItem(page, hasTouch, row(page, 'app.js'), row(page, 'lib'));
  await expect.poll(() => exists(page, 'lib/app.js')).toBe(true);

  // Files ⋯ → Sort A–Z forgets the dragged order
  await files(page);
  await page.getByRole('button', { name: 'More file actions' }).click();
  await page.getByRole('menuitem', { name: /^Sort A–Z/ }).click();
  await expect.poll(() => rowPaths(page)).toEqual(['lib', 'lib/app.js', 'lib/inner.js', 'index.html', 'main.js', 'style.css']);
});

test('tabs and Open editors: a dragged tab lifts and the others slide aside to make room', async ({ page, hasTouch }) => {
  await project(page, { openEditorsOpen: true });
  for (const f of ['index.html', 'style.css', 'main.js']) await openFile(page, f);
  const tab = (name) => page.locator('#pane-0 .tab', { hasText: name });
  const domTabs = () => page.locator('#pane-0 .tab .tab-name').allTextContents();
  // the tab bar
  await dragItem(page, hasTouch, tab('index.html'), tab('main.js'), { x: 0.8, y: 0.5 }, {
    during: async () => {
      await expect.poll(domTabs).toEqual(['style.css', 'main.js', 'index.html']);
      await expect(tab('index.html')).toHaveClass(/drag-origin/);
    },
  });
  await expect.poll(() => tabNames(page)).toEqual(['style.css', 'main.js', 'index.html']);
  // the Open editors list
  await files(page);
  const oe = (name) => page.locator('.oe-list .oe-row', { hasText: name });
  const domRows = () => page.locator('.oe-list .oe-row .oe-name').allTextContents();
  await expect.poll(domRows).toEqual(['style.css', 'main.js', 'index.html']);
  await dragItem(page, hasTouch, oe('index.html'), oe('style.css'), { x: 0.5, y: 0.25 }, {
    during: () => expect.poll(domRows).toEqual(['index.html', 'style.css', 'main.js']),
  });
  await expect.poll(() => tabNames(page)).toEqual(['index.html', 'style.css', 'main.js']);
  await expect.poll(domRows).toEqual(['index.html', 'style.css', 'main.js']);
});

/**
 * Non-passive touchmove listeners on an element (DevTools protocol). A
 * browser only lets a page stop a touch from scrolling if such a listener
 * was there when the finger landed — one added at the press is too late.
 */
async function blockingTouchMove(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  await cdp.detach();
  return listeners.filter((l) => l.type === 'touchmove' && !l.passive).length;
}

test('a long-pressed tab or row drags — its list never scrolls under the finger (a full tab bar, a long tree)', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch only: a mouse never scrolls the list');
  await project(page, { compactFolders: false, openEditorsOpen: true });
  const names = Array.from({ length: 40 }, (_, i) => `f${String(i).padStart(2, '0')}.js`);
  await page.evaluate(async (list) => { for (const n of list) await window.__app.project.fs.writeBytes(n, new Uint8Array(0)); }, names);
  await page.evaluate(() => window.__app.tree.refresh());
  for (const n of names.slice(0, 12)) await openFile(page, n);
  // each list can stop the browser's scrolling before any finger is down
  for (const sel of ['#pane-0 .tab-bar', '#sidebar .tree', '.oe-list']) expect(await blockingTouchMove(page, sel), sel).toBeGreaterThan(0);
  // the tab bar overflows; from its start, drag a tab to the left: the bar must not scroll instead
  const bar = page.locator('#pane-0 .tab-bar');
  await bar.evaluate((el) => { el.scrollLeft = 0; });
  expect(await bar.evaluate((el) => el.scrollWidth > el.clientWidth + 50)).toBe(true);
  const tab = (name) => page.locator('#pane-0 .tab', { hasText: name });
  await dragItem(page, hasTouch, tab('f02.js'), tab('f00.js'), { x: 0.2, y: 0.5 }); // both fully shown (nothing scrolls them into view)
  await expect.poll(() => tabNames(page)).toEqual(['f02.js', 'f00.js', 'f01.js', ...names.slice(3, 12)]);
  await page.waitForTimeout(300); // after the drop, the bar doesn't jump to the active tab (f11, far right)
  expect(await bar.evaluate((el) => el.scrollLeft)).toBe(0);
  // the same in a long file tree: drag a row up, the tree stays put
  await files(page);
  const scroller = page.locator('#sidebar .tree');
  await scroller.evaluate((el) => { el.scrollTop = 0; });
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 100)).toBe(true);
  const before = await page.evaluate(() => window.__app.tree.order());
  await dragItem(page, hasTouch, row(page, 'f05.js'), row(page, 'f02.js'), { x: 0.5, y: 0.3 });
  await expect.poll(() => page.evaluate(() => window.__app.tree.order().filter((p) => /^f0[0-6]/.test(p))))
    .toEqual(['f00.js', 'f01.js', 'f05.js', 'f02.js', 'f03.js', 'f04.js', 'f06.js']);
  await page.waitForTimeout(300);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  expect(before.length).toBe(await page.evaluate(() => window.__app.tree.order().length));
});

test('a tab held at the edge of the bar does not scroll the bar until it is moved toward that edge', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch only');
  await project(page);
  const names = Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, '0')}.js`);
  await page.evaluate(async (list) => { for (const n of list) await window.__app.project.fs.writeBytes(n, new Uint8Array(0)); }, names);
  for (const n of names) await openFile(page, n);
  const bar = page.locator('#pane-0 .tab-bar');
  await bar.evaluate((el) => { el.scrollLeft = 0; });
  // the tab cut off by the bar's right edge, held 12 px from that edge
  const edge = await bar.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const t = [...el.querySelectorAll('.tab')].find((x) => x.getBoundingClientRect().right > r.right);
    return { name: t.querySelector('.tab-name').textContent, x: r.right - 12, y: r.top + r.height / 2 };
  });
  const to = await page.locator('#pane-0 .tab', { hasText: 'f00.js' }).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: edge.x, y: edge.y }] });
  await page.waitForTimeout(650);
  // lifted and moved a little — away from the edge, still near it: the bar stays put
  for (const dx of [-4, -8, -12, -14]) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: edge.x + dx, y: edge.y }] }); await page.waitForTimeout(40); }
  await expect(page.locator('.drag-lift')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await bar.evaluate((el) => el.scrollLeft)).toBe(0);
  // then to the first tab
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: edge.x - 14 + ((to.x + 10 - edge.x + 14) * i) / 8, y: edge.y }] }); await page.waitForTimeout(20); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect.poll(async () => (await tabNames(page))[0]).toBe(edge.name);
  expect(await bar.evaluate((el) => el.scrollLeft)).toBe(0);
  // moved to the edge, it does scroll on (to reach the tabs beyond it)
  const r = await bar.boundingBox();
  const tabF01 = page.locator('#pane-0 .tab', { hasText: 'f01.js' });
  let t = null;
  await expect.poll(async () => (t = await tabF01.boundingBox())).not.toBeNull(); // (the bar may be redrawing after the drop)
  const cdp2 = await page.context().newCDPSession(page);
  const y = t.y + t.height / 2;
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t.x + t.width / 2, y }] });
  await page.waitForTimeout(650);
  for (let i = 1; i <= 8; i++) { await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: t.x + t.width / 2 + ((r.x + r.width - 6 - t.x - t.width / 2) * i) / 8, y }] }); await page.waitForTimeout(20); }
  await expect.poll(() => bar.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp2.detach();
});

test('explorer: cut / copy / paste and multi-select', async ({ page, hasTouch }) => {
  await project(page, { compactFolders: false });
  await writeProjectFile(page, 'lib/keep.txt', 'k');
  await writeProjectFile(page, 'lib/style.css', 'already here');
  await page.evaluate(() => window.__app.tree.refresh());
  // Select (from the menu), then taps add rows
  await rowMenu(page, hasTouch, 'main.js');
  await page.getByRole('menuitem', { name: /^Select/ }).click();
  await row(page, 'style.css').click();
  await expect(page.locator('.tree-selbar')).toContainText('2 selected');
  await page.locator('.tree-selbar').getByRole('button', { name: 'Copy' }).click();
  await expect(page.locator('.tree-selbar')).toBeHidden();
  // paste into lib (from its menu): the clash gets " copy", nothing is overwritten
  await rowMenu(page, hasTouch, 'lib');
  await page.getByRole('menuitem', { name: 'Paste into lib' }).click();
  await expect.poll(() => exists(page, 'lib/main.js')).toBe(true);
  await expect.poll(() => exists(page, 'lib/style copy.css')).toBe(true); // pasted one after the other
  expect(await page.evaluate(async () => new TextDecoder().decode((await window.__app.project.fs.readBytes('lib/style.css')).bytes))).toBe('already here');
  expect(await exists(page, 'main.js')).toBe(true); // copied, not moved
  // cut + paste moves
  await rowMenu(page, hasTouch, 'index.html');
  await page.getByRole('menuitem', { name: 'Cut' }).click();
  await expect(row(page, 'index.html')).toHaveClass(/cut/);
  await rowMenu(page, hasTouch, 'lib');
  await page.getByRole('menuitem', { name: 'Paste into lib' }).click();
  await expect.poll(() => exists(page, 'lib/index.html')).toBe(true);
  expect(await exists(page, 'index.html')).toBe(false);
});

test('explorer: Open Editors list, filter box, auto-reveal, compact single-child folders', async ({ page }) => {
  await project(page);
  await writeProjectFile(page, 'a/b/c/deep.js', 'd');
  await page.evaluate(() => window.__app.tree.refresh());
  // compact: a/b/c is one row
  await files(page);
  await expect(row(page, 'a/b/c')).toBeVisible();
  await expect(row(page, 'a/b/c').locator('.tname')).toHaveText('a/b/c');
  await expect(row(page, 'a')).toHaveCount(0);
  // auto-reveal: opening a deep file shows it in the tree
  await openFile(page, 'a/b/c/deep.js');
  await files(page);
  await expect(row(page, 'a/b/c/deep.js')).toBeVisible();
  await expect(row(page, 'a/b/c/deep.js')).toHaveClass(/active/);
  // Open editors: folded to a count; unfolded, a row per tab, ✕ closes
  await openFile(page, 'style.css');
  await files(page);
  const oe = page.locator('.open-editors');
  await expect(oe.locator('.oe-count')).toHaveText('2');
  await oe.locator('.oe-head').click();
  await expect(oe.locator('.oe-row')).toHaveCount(2);
  await oe.locator('.oe-row', { hasText: 'deep.js' }).getByRole('button', { name: 'Close deep.js' }).click();
  await expect(oe.locator('.oe-row')).toHaveCount(1);
  expect(await tabNames(page)).toEqual(['style.css']);
  // the filter: matching files from the whole project, as a list
  await page.locator('.tree-filter').fill('dee');
  await expect(row(page, 'a/b/c/deep.js')).toBeVisible();
  await expect(page.locator('.tree-row')).toHaveCount(1);
  await page.locator('.tree-filter').fill('');
  await expect(row(page, 'index.html')).toBeVisible();
});

test('explorer: Delete goes to a 7-day trash and can be restored', async ({ page, hasTouch }) => {
  await project(page, { compactFolders: false });
  await writeProjectFile(page, 'src/a.js', 'original a');
  await writeProjectFile(page, 'src/empty/.keep', '');
  await page.evaluate(() => window.__app.tree.refresh());
  // Delete: no question, and Undo right away
  await rowMenu(page, hasTouch, 'style.css');
  await page.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect.poll(() => exists(page, 'style.css')).toBe(false);
  await page.locator('.toast', { hasText: 'Deleted style.css' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => exists(page, 'style.css')).toBe(true);
  // a folder, restored later from Files ⋯ → Trash
  await page.evaluate(() => window.__app.actions.removeMany(['src']));
  await expect.poll(() => exists(page, 'src')).toBe(false);
  await page.evaluate(() => window.__app.showTrash());
  const entry = page.locator('.trash-row', { hasText: 'src' });
  await expect(entry).toContainText('7 days left');
  await entry.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => exists(page, 'src/a.js')).toBe(true);
  await expect.poll(() => exists(page, 'src/empty/.keep')).toBe(true); // restored one file after another
  expect(await page.evaluate(async () => new TextDecoder().decode((await window.__app.project.fs.readBytes('src/a.js')).bytes))).toBe('original a');
  await expect(page.locator('.trash-row')).toHaveCount(0);
  // after 7 days it is gone for good (dropped when the project opens)
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__app.actions.removeMany(['main.js']));
  await expect.poll(() => exists(page, 'main.js')).toBe(false);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('codeeditor-trash');
    open.onsuccess = () => {
      const st = open.result.transaction('items', 'readwrite').objectStore('items');
      const all = st.getAll();
      all.onsuccess = () => { for (const e of all.result) st.put({ ...e, deletedAt: Date.now() - 8 * 86400000 }); st.transaction.oncomplete = resolve; };
    };
    open.onerror = reject;
  }));
  await page.evaluate(async () => { const app = window.__app; await app.openProject(app.project.meta); });
  await page.evaluate(() => window.__app.showTrash());
  await expect(page.locator('.modal .panel-note')).toContainText('The trash is empty');
});
