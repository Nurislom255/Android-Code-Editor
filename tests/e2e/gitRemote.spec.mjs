// Push and clone over HTTP with a real git server (see gitHttpServer.mjs).
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, setText, runCommand } from './helpers.mjs';
import { startGitServer } from './gitHttpServer.mjs';

let srv;
test.beforeAll(async () => { srv = await startGitServer(); });
test.afterAll(() => srv && srv.close());

test('push to a remote, then clone it into a new project', async ({ page }, info) => {
  const repo = `site-${info.project.name}.git`;
  srv.createBare(repo);
  // No CORS proxy needed: this test server sends CORS headers itself.
  await boot(page, { gitAuthorName: 'Tester', gitAuthorEmail: 'tester@example.com', gitCorsProxy: '' });
  await newProject(page, 'pushme', 'web');
  await page.evaluate(() => window.__app.showPanel('git'));
  const panel = page.locator('.side-panel[data-panel="git"]');
  await panel.getByRole('button', { name: 'Initialize repository' }).click();
  await panel.locator('textarea').fill('First commit');
  await panel.getByRole('button', { name: 'Stage all & commit' }).click();
  await expect(panel.locator('.commit-row')).toHaveCount(1);

  await panel.getByRole('button', { name: 'Push' }).click();
  await page.locator('.modal input').fill(`${srv.url}/${repo}`); // remote URL
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await page.locator('.modal input').fill('dummy-token'); // the test server accepts anything
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.toast', { hasText: 'Pushed.' })).toBeVisible({ timeout: 20000 });
  expect(srv.log(repo)).toEqual(['First commit']);

  // second commit + push (token is remembered, encrypted)
  await openFile(page, 'app.js');
  await setText(page, '// v2\n');
  await runCommand(page, 'save');
  await page.evaluate(() => window.__app.showPanel('git'));
  await panel.locator('textarea').fill('Second');
  await panel.getByRole('button', { name: 'Stage all & commit' }).click();
  await expect(panel.locator('.commit-row')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Push' }).click();
  await expect.poll(() => srv.log(repo), { timeout: 20000 }).toEqual(['Second', 'First commit']);

  // clone into a new project
  await page.evaluate(() => { window.__app.cloneRepo(); });
  await page.locator('.modal input').fill(`${srv.url}/${repo}`);
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await page.locator('.modal input').fill('cloned');
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#project-name')).toHaveText('cloned', { timeout: 20000 });
  expect(await page.evaluate(() => window.__app.project.fs.readText('app.js'))).toBe('// v2\n');
  await page.evaluate(() => window.__app.showPanel('git'));
  await expect(panel.locator('.commit-row .cmsg')).toHaveText(['Second', 'First commit']);

  // someone else pushes; Pull brings it in and the open editor updates
  srv.commitFromCli(repo, 'notes.txt', 'from the CLI\n', 'Third (CLI)');
  await panel.getByRole('button', { name: 'Pull' }).click();
  await expect(page.locator('.toast', { hasText: 'Pulled.' })).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => window.__app.project.fs.readText('notes.txt'))).toBe('from the CLI\n');
  await expect(panel.locator('.commit-row .cmsg').first()).toHaveText('Third (CLI)');
});
