// scripts/make-icons.mjs — renders static/icons/icon.svg to the PNG sizes the
// web manifest / Android need, using the Playwright Chromium already used for
// tests. Run once after changing the SVG: node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../static/icons');
const svg = await readFile(path.join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0.12]]) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons get a safe-zone margin and a full-bleed background.
  await page.setContent(`<html><body style="margin:0;background:${pad ? '#14161a' : 'transparent'}">
    <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
    <div style="width:${size * (1 - pad * 2)}px;height:${size * (1 - pad * 2)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body></html>`);
  await page.screenshot({ path: path.join(dir, name), omitBackground: !pad });
}
await browser.close();
console.log('icons written');
