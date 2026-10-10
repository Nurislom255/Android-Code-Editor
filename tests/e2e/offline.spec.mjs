// Offline support and updates (service worker). Kept apart from the other
// specs: installing the app's offline copy is heavy, and timing tests (the
// 5,000-line benchmark in app.spec) must not run at the same moment.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setText } from './helpers.mjs';

test('works offline after the first visit (service worker)', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(baseURL);
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && reg.active);
  }, null, { timeout: 20000 });
  await page.reload(); // now controlled by the worker
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  await page.getByRole('button', { name: /Scratch file/ }).click();
  await setText(page, '[1, 2, 3].map((n) => n * 2)');
  await page.locator('#btn-run').click();
  await expect(page.locator('#console-view .console-line.result')).toContainText('[ 2, 4, 6 ]');
  // a lazily loaded chunk (Python mode) also comes from the cache
  await page.evaluate(() => window.__app.ws.newUntitled({ name: 'x.py', content: 'def f():\n    pass\n' }));
  await expect(page.locator('.pane.focused-pane .tok-keyword').first()).toHaveText('def');
  await ctx.close();
});


/** docs/ on its own port, where a test can "deploy" new versions of single files. */
async function deployServer() {
  const root = fileURLToPath(new URL('../../docs/', import.meta.url));
  const next = new Map();
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1) || 'index.html';
    try {
      const body = next.has(p) ? next.get(p) : await readFile(path.join(root, p));
      const type = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' }[path.extname(p)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/`, deploy: (file, body) => next.set(file, body), close: () => server.close() };
}

test('a new deploy: "Version … is ready" with a Reload button that switches to it', async ({ browser }) => {
  const site = await deployServer();
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  try {
    await page.goto(site.url);
    await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }, null, { timeout: 20000 });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller && !!window.__app);
    // The next build reaches the website.
    const sw = await readFile(fileURLToPath(new URL('../../docs/sw.js', import.meta.url)), 'utf8');
    site.deploy('sw.js', sw.replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-next'"));
    site.deploy('version.json', JSON.stringify({ version: '9.9.9', built: '2030-01-01T10:00:00.000Z' }));
    await page.evaluate(() => { window.__before = true; return window.__app.checkForUpdate(); });
    const reload = page.locator('.toast', { hasText: 'Version 9.9.9 is ready' }).getByRole('button', { name: 'Reload' });
    await expect(reload).toBeVisible({ timeout: 20000 });
    await reload.click();
    await page.waitForFunction(() => !window.__before && !!window.__app, null, { timeout: 20000 });
    expect(await page.evaluate(async () => (await caches.keys()).some((k) => k.endsWith('-next')))).toBe(true);
  } finally {
    await ctx.close();
    site.close();
  }
});
