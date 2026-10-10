// Source control panel against the browser's private storage (OPFS).
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, setText, runCommand, mod } from './helpers.mjs';

test('init, commit, see changes + gutter markers, branch', async ({ page }) => {
  await boot(page, { gitAuthorName: 'Tester', gitAuthorEmail: 'tester@example.com' });
  await newProject(page, 'repo', 'web');
  await page.evaluate(() => window.__app.showPanel('git'));
  const panel = page.locator('.side-panel[data-panel="git"]');
  await panel.getByRole('button', { name: 'Initialize repository' }).click();
  await expect(panel.locator('.git-section-title', { hasText: 'Changes (4)' })).toBeVisible();
  await panel.locator('textarea').fill('Initial commit');
  await panel.getByRole('button', { name: 'Stage all & commit' }).click();
  await expect(panel.locator('.commit-row .cmsg')).toHaveText(['Initial commit']);
  await expect(page.locator('#statusbar')).toContainText('main');

  // edit a committed file → modified; gutter shows a marker
  await openFile(page, 'app.js');
  const committed = await page.evaluate(() => window.__app.ws.view.state.doc.toString());
  const lines = committed.split('\n');
  lines[2] = "console.log('edited');"; // change one line…
  await setText(page, ['// new first line', ...lines].join('\n')); // …and insert one
  await runCommand(page, 'save');
  await page.evaluate(() => window.__app.showPanel('git'));
  await expect(panel.locator('.git-file', { hasText: 'app.js' }).locator('.git-status')).toHaveText('M');
  // line 1 was inserted (added), line 2 changed (modified); `:visible` skips
  // CodeMirror's invisible width-measuring spacer element.
  await expect(page.locator('.pane.focused-pane .cm-git-gutter .cm-git-added:visible')).toHaveCount(1);
  await expect(page.locator('.pane.focused-pane .cm-git-gutter .cm-git-modified:visible')).toHaveCount(1);

  // stage → shows under staged; commit
  await panel.getByRole('button', { name: 'Stage app.js' }).click();
  await expect(panel.locator('.git-section-title', { hasText: 'Staged changes (1)' })).toBeVisible();
  await panel.locator('textarea').fill('Change app');
  await panel.getByRole('button', { name: 'Commit 1 staged file' }).click();
  await expect(panel.locator('.commit-row .cmsg')).toHaveText(['Change app', 'Initial commit']);
  await expect(page.locator('.pane.focused-pane .cm-git-gutter .cm-git-modified:visible, .pane.focused-pane .cm-git-gutter .cm-git-added:visible')).toHaveCount(0);

  // new branch through the picker
  await panel.locator('button', { hasText: 'main' }).first().click();
  await page.locator('.palette-item', { hasText: 'Create new branch' }).click();
  await page.locator('.modal input').fill('feature');
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#statusbar')).toContainText('feature');
});

test('diff view and discard', async ({ page }) => {
  await boot(page, { gitAuthorName: 'Tester', gitAuthorEmail: 'tester@example.com' });
  await newProject(page, 'repo2', 'js');
  await page.evaluate(() => window.__app.showPanel('git'));
  const panel = page.locator('.side-panel[data-panel="git"]');
  await panel.getByRole('button', { name: 'Initialize repository' }).click();
  await panel.locator('textarea').fill('first');
  // Ctrl+Enter in the message box commits (and must not insert a line in the editor)
  await panel.locator('textarea').press(`${mod}+Enter`);
  await expect(panel.locator('.commit-row')).toHaveCount(1);
  await openFile(page, 'main.js');
  await setText(page, 'brand new content\n');
  await runCommand(page, 'save');
  await page.evaluate(() => window.__app.showPanel('git'));
  await panel.locator('.git-file .gname', { hasText: 'main.js' }).click();
  await expect(page.locator('.modal .diff-row.add')).toContainText('brand new content');
  await page.locator('.modal [aria-label="Close"]').click();
  await panel.getByRole('button', { name: 'Discard changes to main.js' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Discard' }).click();
  await expect(panel.locator('.git-section-title', { hasText: 'Changes (0)' })).toBeVisible();
  // the open editor picks up the restored file
  await expect.poll(() => page.evaluate(() => window.__app.ws.view.state.doc.toString())).toContain('readline()');
});
