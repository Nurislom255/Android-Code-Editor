// Shared helpers for the end-to-end tests.
import { expect } from '@playwright/test';

/** Loads the app, optionally with settings pre-seeded in localStorage. */
export async function boot(page, settings = null) {
  if (settings) {
    await page.addInitScript((s) => {
      if (!sessionStorage.getItem('__seeded')) {
        localStorage.setItem('codeeditor:settings', JSON.stringify(s));
        sessionStorage.setItem('__seeded', '1');
      }
    }, settings);
  }
  await page.goto('/');
  await page.waitForFunction(() => !!window.__app);
}

export const isCompact = (page) => page.evaluate(() => window.__app.layout.compact);

/** Creates a browser-storage project through the UI. template: web | js | empty */
export async function newProject(page, name = 'demo', template = 'web') {
  await page.getByRole('button', { name: /New project/ }).first().click();
  const input = page.locator('.modal input.input');
  await input.fill(name);
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  const label = { web: 'Web page (HTML/CSS/JS)', js: 'JavaScript (console)', empty: 'Empty' }[template];
  await page.locator('.modal').getByRole('button', { name: label }).click();
  await expect(page.locator('#project-name')).toHaveText(name);
  if (template !== 'empty') await page.waitForFunction(() => window.__app.ws.activeDoc);
}

/** Writes a project file directly in OPFS (what another app would do). */
export async function writeProjectFile(page, path, content, { bytes = null } = {}) {
  await page.evaluate(async ({ path, content, bytes }) => {
    const fs = window.__app.project.fs;
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) await fs.createDir(dir, { recursive: true });
    await fs.writeBytes(path, bytes ? new Uint8Array(bytes) : new TextEncoder().encode(content));
  }, { path, content, bytes });
}

export async function readProjectBytes(page, path) {
  return page.evaluate(async (p) => [...(await window.__app.project.fs.readBytes(p)).bytes], path);
}

export async function openFile(page, path) {
  await page.evaluate((p) => window.__app.ws.openPath(p), path);
  await expect(page.locator('.pane.focused-pane .tab.active .tab-name')).toHaveText(path.split('/').pop());
}

export const editorText = (page) => page.evaluate(() => window.__app.ws.view.state.doc.toString());

/** Replaces the whole document and puts the cursor at `cursor` (default: end). */
export async function setText(page, text, cursor = null) {
  await page.evaluate(({ text, cursor }) => {
    const v = window.__app.ws.view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: { anchor: cursor ?? text.length } });
    v.focus();
  }, { text, cursor });
}

export async function focusEditor(page) {
  await page.evaluate(() => window.__app.ws.view.focus());
}

/** Center of the visible code area (away from gutters and screen edges). */
export async function codePoint(page, fx = 0.5, fy = 0.4) {
  const box = await page.locator('.pane.focused-pane .cm-content').boundingBox();
  const scroller = await page.locator('.pane.focused-pane .cm-scroller').boundingBox();
  return { x: box.x + Math.min(box.width, scroller.width) * fx, y: scroller.y + scroller.height * fy };
}

/**
 * Real touch input through the Chrome DevTools Protocol (Playwright's own
 * touchscreen API only taps). Every event carries an explicit timestamp, so
 * the gesture's speed is exactly `duration` ms no matter how busy the test
 * machine is — the recognizer reads event.timeStamp.
 */
async function touchSequence(page, frames) {
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  for (const f of frames) {
    await cdp.send('Input.dispatchTouchEvent', { type: f.type, touchPoints: f.points, timestamp: t0 + f.t / 1000 });
  }
  await cdp.detach();
}

/** fingers: 1 or 2 (second finger `spread` px below the first). */
export async function swipe(page, { from, to, fingers = 1, duration = 160, steps = 6, spread = 60 }) {
  const pts = (x, y) => (fingers === 2 ? [{ x, y, id: 1 }, { x, y: y + spread, id: 2 }] : [{ x, y, id: 1 }]);
  const frames = [{ type: 'touchStart', points: pts(from.x, from.y), t: 0 }];
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    frames.push({ type: 'touchMove', points: pts(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f), t: duration * f });
  }
  frames.push({ type: 'touchEnd', points: [], t: duration + 5 });
  await touchSequence(page, frames);
}

export async function pinch(page, { center, startGap = 60, endGap = 180, duration = 300, steps = 10 }) {
  const pts = (gap) => [{ x: center.x - gap / 2, y: center.y, id: 1 }, { x: center.x + gap / 2, y: center.y, id: 2 }];
  const frames = [{ type: 'touchStart', points: pts(startGap), t: 0 }];
  for (let i = 1; i <= steps; i++) frames.push({ type: 'touchMove', points: pts(startGap + (endGap - startGap) * (i / steps)), t: duration * (i / steps) });
  frames.push({ type: 'touchEnd', points: [], t: duration + 5 });
  await touchSequence(page, frames);
}

export async function twoFingerTap(page, at) {
  const pts = [{ x: at.x - 40, y: at.y, id: 1 }, { x: at.x + 40, y: at.y, id: 2 }];
  await touchSequence(page, [{ type: 'touchStart', points: pts, t: 0 }, { type: 'touchEnd', points: [], t: 80 }]);
}

export const completionOpen = (page) => page.locator('.cm-tooltip-autocomplete');

/** Runs an app command and waits for it to finish (don't use for commands
 * that open a dialog the test must answer — that would wait forever). */
export async function runCommand(page, id) {
  await page.evaluate(async (c) => {
    const app = window.__app;
    const view = app.ws.activeDoc ? app.ws.view : null;
    await app.commands()[c].run(view);
  }, id);
}

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Drags one element onto another: press and move with a mouse; on a touch
 * screen hold until the menu opens, then move (ui/dragMove.js).
 * `at` is where on the target to let go, as fractions of its box.
 */
export async function dragItem(page, hasTouch, from, to, at = { x: 0.5, y: 0.5 }) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const x0 = a.x + Math.min(30, a.width / 2), y0 = a.y + a.height / 2;
  const x1 = b.x + b.width * at.x, y1 = b.y + b.height * at.y;
  if (!hasTouch) {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 10 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  await page.waitForTimeout(650);
  await expect(page.locator('.popup-menu')).toBeVisible(); // the long-press menu comes first
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10 }] });
    await page.waitForTimeout(20);
  }
  await expect(page.locator('.popup-menu')).toHaveCount(0);
  await expect(page.locator('.drag-chip')).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
