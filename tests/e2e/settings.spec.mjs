// Settings as pages with a search box; the keys-bar editor; keyboard
// shortcuts (ROADMAP Phase 2 part 2: 2.1, 2.7, 2.9).
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, editorText, setText } from './helpers.mjs';

const view = (page) => page.locator('.settings-view');
const nav = (page, name) => view(page).locator('.sv-nav').getByRole('button', { name: new RegExp(`^${name}`) });
const narrow = (page) => page.viewportSize().width < 720;

test('phone: the list of pages, a page, ← and Android Back, ✕', async ({ page }) => {
  test.skip(!narrow(page), 'narrow screens');
  await boot(page);
  await page.evaluate(() => window.__app.openSettings());
  await expect(view(page).locator('.sv-nav')).toBeVisible();
  await expect(view(page).locator('.sv-main')).toBeHidden();
  await nav(page, 'Editor').click();
  await expect(view(page).locator('.sv-title')).toHaveText('Editor');
  await expect(view(page).getByLabel('Line numbers')).toBeAttached();
  await expect(view(page).locator('.sv-nav')).toBeHidden();
  await view(page).getByRole('button', { name: 'Back' }).click();
  await expect(view(page).locator('.sv-nav')).toBeVisible();
  // Android's Back button: page → list → closed
  await nav(page, 'Gestures').click();
  await expect(view(page).locator('.sv-title')).toHaveText('Gestures');
  await page.goBack();
  await expect(view(page).locator('.sv-nav')).toBeVisible();
  await page.goBack();
  await expect(view(page)).toBeHidden();
  // ✕ from a page closes it all
  await page.evaluate(() => window.__app.openSettings('run'));
  await expect(view(page).locator('.sv-title')).toHaveText('Run');
  await view(page).getByRole('button', { name: 'Close settings' }).click();
  await expect(view(page)).toBeHidden();
  await page.evaluate(() => window.__app.openSettings());
  await expect(view(page).locator('.sv-nav')).toBeVisible();
});

test('wide screens: the pages on the left, the page on the right; Esc closes', async ({ page }) => {
  test.skip(narrow(page), 'wide screens');
  await boot(page);
  await page.locator('#activitybar .activity[data-panel="settings"]').click();
  await expect(view(page).locator('.sv-nav')).toBeVisible();
  await expect(view(page).locator('.sv-page-title')).toHaveText('Appearance');
  await nav(page, 'Run').click();
  await expect(view(page).locator('.sv-page-title')).toHaveText('Run');
  await expect(view(page).getByLabel('Time limit (seconds)')).toBeVisible();
  await expect(view(page).locator('.sv-nav')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(view(page)).toBeHidden();
});

test('search looks through every page; a found setting works right there', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__app.openSettings());
  const search = view(page).getByLabel('Search settings');
  await search.fill('semicolon');
  await expect(view(page).locator('.sv-result-page', { hasText: 'Typing & autocomplete' })).toBeVisible();
  await view(page).getByLabel('Automatic semicolons').uncheck();
  expect(await page.evaluate(() => window.__app.settings.autoSemicolons)).toBe(false);
  // commands of the shortcuts page are found by name
  await search.fill('delete line');
  await expect(view(page).locator('.sc-row', { hasText: 'Delete line' })).toBeVisible();
  // a big editor shows as a link to its page
  await search.fill('layout');
  await view(page).locator('.sv-stub', { hasText: 'Keys bar layout' }).click();
  await expect(view(page).locator('.kbe')).toBeVisible();
  if (narrow(page)) await view(page).getByRole('button', { name: 'Back' }).click(); // (on a phone, the box is on the list)
  await search.fill('zzzz');
  await expect(view(page).locator('.sv-empty')).toHaveText(/No setting matches/);
});

test('keys bar layout: a key replaced in Settings is on the bar; Tab stays; reset', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch-only');
  await boot(page, { keysBarMode: 'always' });
  await newProject(page, 'kb', 'js');
  await openFile(page, 'main.js');
  await page.evaluate(() => window.__app.openSettings('keysbar'));
  const ed = view(page).locator('.kbe');
  await expect(ed.locator('.kbe-tab[aria-selected="true"]')).toContainText('this device');
  await ed.locator('.kbe-key.kbe-ctx').first().click();
  await page.getByRole('menuitem', { name: 'Replace with…' }).click();
  await page.locator('.kbe-pick', { has: page.locator('.kbe-pick-label', { hasText: /^Save$/ }) }).click();
  const profile = await page.evaluate(() => window.__app.keysBar.profile);
  expect(await page.evaluate((p) => window.__app.settings.keysBar[p].flat(), profile)).toContain('@save');
  // Tab can't be removed
  await ed.locator('.kbe-key', { hasText: /^Tab$/ }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.locator('.toast', { hasText: 'Tab must stay' })).toBeVisible();
  // the bar has the new key
  await view(page).getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('#keys-bar .key[aria-label^="Save"]')).toBeVisible();
  await page.locator('#keys-bar .key[aria-label^="Save"]').tap();
  // and the setting survives a reload
  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  expect(await page.evaluate((p) => window.__app.settings.keysBar[p].flat(), profile)).toContain('@save');
  await page.evaluate(() => window.__app.openSettings('keysbar'));
  await view(page).getByRole('button', { name: 'Reset this layout' }).click();
  expect(await page.evaluate(() => window.__app.settings.keysBar)).toEqual({});
});

test('symbol keys: a key\'s swipes are edited one by one; gaps are refused', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__app.openSettings('keysbar'));
  const first = view(page).locator('.sse-key').first();
  await expect(first.locator('.sse-label')).toHaveText('(');
  await first.click();
  await page.getByRole('menuitem', { name: 'Edit…' }).click();
  const modal = page.locator('.modal');
  await expect(modal.getByLabel('Swipe left')).toHaveValue('{}');
  await modal.getByLabel('Swipe right').fill('<>');
  await modal.getByRole('button', { name: 'Save' }).click();
  expect(await page.evaluate(() => window.__app.settings.keysLayouts.js.split(' ')[0])).toBe('(^)^[]^{}^<>');
  await first.click();
  await page.getByRole('menuitem', { name: 'Edit…' }).click();
  await modal.getByLabel('Swipe down').fill('');
  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(modal.locator('.field-error')).toHaveText(/no gaps/);
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await view(page).getByRole('button', { name: /^Reset JavaScript/ }).click();
  expect(await page.evaluate(() => window.__app.settings.keysLayouts.js.split(' ')[0])).toBe('(^)^[]^{}');
});

test('a shortcut changed in Settings works, the old one stops; a pressed one is recorded', async ({ page }) => {
  await boot(page);
  await newProject(page, 'sc', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'one\ntwo\nthree', 4);
  await page.evaluate(() => window.__app.openSettings('shortcuts'));
  await view(page).getByLabel('Find a command or a key').fill('delete line');
  await view(page).locator('.sc-row', { hasText: 'Delete line' }).click();
  const modal = page.locator('.modal');
  await modal.getByLabel('Type the shortcut').fill('ctrl+e');
  await expect(modal.locator('.sc-capture-key')).toHaveText('Ctrl+E');
  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(view(page).locator('.sc-row', { hasText: 'Delete line' }).locator('.sc-key')).toHaveText('Ctrl+E');
  // pressing it in the dialog records it; one already used moves (and says so)
  await view(page).getByLabel('Find a command or a key').fill('duplicate');
  await view(page).locator('.sc-row', { hasText: 'Duplicate line' }).click();
  await modal.locator('.sc-capture').focus();
  await page.keyboard.press('Control+e');
  await expect(modal.locator('.sc-capture-key')).toHaveText('Ctrl+E');
  await expect(modal.locator('.sc-msg')).toContainText('Delete line');
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await view(page).getByRole('button', { name: 'Close settings' }).click();
  await page.evaluate(() => window.__app.ws.view.focus());
  await page.keyboard.press('Control+Shift+K');
  expect(await editorText(page)).toBe('one\ntwo\nthree');
  await page.keyboard.press('Control+e');
  expect(await editorText(page)).toBe('one\nthree');
  // shown where shortcuts are shown
  expect(await page.evaluate(() => window.__app.commandList().find((c) => c.id === 'deleteLine').key)).toBe('Ctrl+E');
  // back to the default
  await page.evaluate(() => window.__app.updateSettings({ keyBindings: {} }));
  await page.evaluate(() => window.__app.ws.view.focus());
  await page.keyboard.press('Control+Shift+K');
  expect(await editorText(page)).toBe('one');
});

test('phone: Settings opened from the drawer — ← and Android Back return to the drawer, on its panel; ✕ goes to the code', async ({ page }) => {
  test.skip(!narrow(page), 'narrow screens');
  await boot(page);
  await newProject(page, 'dr', 'js');
  // the drawer, on Search
  await page.locator('#btn-sidebar').click();
  await page.locator('.sidebar-tabs .activity[data-panel="search"]').click();
  await expect(page.locator('#app')).toHaveClass(/drawer-open/);
  // → Settings from the drawer's tabs
  await page.locator('.sidebar-tabs .activity[data-panel="settings"]').click();
  await expect(view(page)).toBeVisible();
  await expect(page.locator('#app')).not.toHaveClass(/drawer-open/);
  // the list has a ← now: back to the drawer, still on Search
  await view(page).getByRole('button', { name: 'Back to the side panels' }).click();
  await expect(view(page)).toBeHidden();
  await expect(page.locator('#app')).toHaveClass(/drawer-open/);
  await expect(page.locator('.side-panel[data-panel="search"]')).toHaveClass(/active/);
  // a page, then Android Back twice: page → list → the drawer
  await page.locator('.sidebar-tabs .activity[data-panel="settings"]').click();
  await nav(page, 'Editor').click();
  await page.goBack();
  await expect(view(page).locator('.sv-nav')).toBeVisible();
  await page.goBack();
  await expect(view(page)).toBeHidden();
  await expect(page.locator('#app')).toHaveClass(/drawer-open/);
  // ✕ closes Settings and the drawer stays closed: straight to the code
  await page.locator('.sidebar-tabs .activity[data-panel="settings"]').click();
  await view(page).getByRole('button', { name: 'Close settings' }).click();
  await expect(view(page)).toBeHidden();
  await expect(page.locator('#app')).not.toHaveClass(/drawer-open/);
});
