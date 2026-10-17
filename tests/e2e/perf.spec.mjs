// Speed (spec §8). These run in their own Playwright project, after all the
// other tests and one at a time (see playwright.config.mjs): with other tests
// sharing the CPU they would measure the machine's load, not the editor.
import { test, expect, devices } from '@playwright/test';
import { boot, newProject, openFile, writeProjectFile } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

const screen = (name) => { const { defaultBrowserType, ...d } = devices[name]; return d; };
const SCREENS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: screen('Pixel 7'),
  tablet: screen('Galaxy Tab S4 landscape'),
};

for (const [name, use] of Object.entries(SCREENS)) {
  test.describe(name, () => {
    test.use(use);

    test('a 5,000-line file stays responsive while typing (spec §8 benchmark)', async ({ page }) => {
      await boot(page);
      await newProject(page, 'big', 'empty');
      const lines = [];
      for (let i = 0; i < 5000; i++) lines.push(i % 10 === 0 ? `function f${i}(a, b) {` : i % 10 === 9 ? '}' : `  const v${i} = a * ${i} + b; // line ${i}`);
      await writeProjectFile(page, 'big.js', lines.join('\n') + '\n');
      await openFile(page, 'big.js');
      await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ selection: { anchor: Math.floor(v.state.doc.length / 2) }, scrollIntoView: true }); v.focus(); });
      // Time from keystroke to the next painted frame: the median of 40 keys.
      const measure = () => page.evaluate(async () => {
        const v = window.__app.ws.view;
        const times = [];
        for (let i = 0; i < 40; i++) {
          const t = performance.now();
          v.dispatch(v.state.replaceSelection('x'), { userEvent: 'input.type' });
          await new Promise((r) => requestAnimationFrame(() => r()));
          times.push(performance.now() - t);
        }
        times.sort((a, b) => a - b);
        return times[Math.floor(times.length / 2)];
      });
      // Best of up to 3 tries (a moment of background work); a real slowdown shows in every try.
      let ms = Infinity;
      for (let i = 0; i < 3 && ms >= 50; i++) ms = Math.min(ms, await measure());
      console.log(`${name}: median keystroke→frame ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(50); // a frame is 16 ms; generous bound for slow machines
    });
  });
}
