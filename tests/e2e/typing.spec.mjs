// Typing features (ROADMAP Phase 1): automatic semicolons, Complete
// statement, Emmet, linked HTML tags, path and open-file suggestions.
import { test, expect } from '@playwright/test';
import { boot, newProject, openFile, editorText, setText, writeProjectFile, completionOpen, mod } from './helpers.mjs';

const head = (page) => page.evaluate(() => window.__app.ws.view.state.selection.main.head);
const pendingSemis = (page) => page.locator('.pane.focused-pane .cm-pending-semi');

// CodeMirror ignores accepting a suggestion in the first 75 ms after the list
// appears (so a fast typist doesn't accept by accident); a finger is slower.
const settle = (page) => page.waitForTimeout(120);
// On Android, CodeMirror ignores an Enter that arrives within 50 ms of the
// previous edit unless the keyboard changed the text; pause like a person.
//
// Even so, emulated Android Chrome drops ~40 % of synthetic Enter/Backspace
// presses in a plain .txt file (measured), so tests that depend on those keys
// run on the desktop project; on a real phone the keyboard sends them
// through the same CodeMirror key handlers.
const ANDROID_KEYS = 'emulated Android drops synthetic Enter/Backspace (CodeMirror Android key path)';

async function press(page, key) {
  await page.waitForTimeout(80);
  await page.keyboard.press(key);
}

async function cppFile(page, text, cursorMarker = '|') {
  await boot(page, { tabWidth: 4 });
  await newProject(page, 't', 'empty');
  await writeProjectFile(page, 'main.cpp', text.replace(cursorMarker, ''));
  await openFile(page, 'main.cpp');
  await setText(page, text.replace(cursorMarker, ''), text.indexOf(cursorMarker));
}

test.describe('automatic semicolons', () => {
  test('a declaration gets a faded ; that Enter steps over', async ({ page, isMobile }) => {
    test.skip(isMobile, ANDROID_KEYS);
    await cppFile(page, 'int main() {\n    |\n}');
    await page.keyboard.type('int x = 5');
    expect(await editorText(page)).toBe('int main() {\n    int x = 5;\n}');
    await expect(pendingSemis(page)).toHaveCount(1);
    expect(await head(page)).toBe('int main() {\n    int x = 5'.length); // cursor before the ;
    await press(page, 'Enter');
    expect(await editorText(page)).toBe('int main() {\n    int x = 5;\n    \n}');
    expect(await head(page)).toBe('int main() {\n    int x = 5;\n    '.length);
    await expect(pendingSemis(page)).toHaveCount(0);
  });

  test('Enter after an operator breaks the line and keeps the ; pending at the end', async ({ page, isMobile }) => {
    test.skip(isMobile, ANDROID_KEYS);
    await cppFile(page, 'int main() {\n    |\n}');
    await page.keyboard.type('std::cout << "a" <<');
    await press(page, 'Enter');
    await page.keyboard.type('"b"');
    expect(await editorText(page)).toMatch(/std::cout << "a" <<\n\s+"b";\n}$/);
    await expect(pendingSemis(page)).toHaveCount(1);
  });

  test('typing ; steps over the pending one; calls keep it after the auto-closed )', async ({ page }) => {
    await cppFile(page, 'int main() {\n    |\n}');
    await page.keyboard.type('foo(');
    expect(await editorText(page)).toBe('int main() {\n    foo();\n}');
    await page.keyboard.type('1;');
    expect(await editorText(page)).toBe('int main() {\n    foo(1);\n}');
    expect(await head(page)).toBe('int main() {\n    foo(1);'.length);
  });

  test('a function header never gets a ;', async ({ page }) => {
    await cppFile(page, '|');
    await page.keyboard.type('int square(int x) {');
    expect(await editorText(page)).toBe('int square(int x) {}');
  });

  test('Tab and swipe right jump past the ;, like the end of a snippet', async ({ page }) => {
    await cppFile(page, 'int main() {\n    |\n}');
    await page.keyboard.type('foo(1');
    expect(await editorText(page)).toBe('int main() {\n    foo(1);\n}');
    await page.keyboard.press('Tab');
    expect(await head(page)).toBe('int main() {\n    foo(1);'.length);
    // swipe right runs the same "autocomplete" action
    await setText(page, 'int main() {\n    \n}', 'int main() {\n    '.length);
    await page.keyboard.type('bar(2');
    expect(await page.evaluate(() => window.__app.run('autocomplete'))).toBe('Past ;');
    expect(await editorText(page)).toBe('int main() {\n    bar(2);\n}');
    expect(await head(page)).toBe('int main() {\n    bar(2);'.length);
  });

  test('Backspace right after the ; appears removes it for that line', async ({ page, isMobile }) => {
    test.skip(isMobile, ANDROID_KEYS);
    await cppFile(page, 'int main() {\n    |\n}');
    await page.keyboard.type('return ');
    expect(await editorText(page)).toBe('int main() {\n    return ;\n}');
    await press(page, 'Backspace');
    expect(await editorText(page)).toBe('int main() {\n    return \n}');
    await page.keyboard.type('0 ');
    expect(await editorText(page)).toBe('int main() {\n    return 0 \n}'); // not re-added on this line
  });

  test('undo removes the ; together with the typing that created it', async ({ page }) => {
    await cppFile(page, 'int main() {\n    |\n}');
    await page.keyboard.type('x = 1');
    await page.keyboard.press(`${mod}+z`);
    expect(await editorText(page)).toBe('int main() {\n    \n}');
  });

  test('never in for headers, if headers or #include', async ({ page }) => {
    await cppFile(page, '|\nint main() {\n    \n}');
    await page.keyboard.type('#include <vector>');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('for (int i = 0; i < 3; i++) ');
    expect(await editorText(page)).toBe('#include <vector>\nint main() {\n    for (int i = 0; i < 3; i++) \n}');
  });

  test('a chain continued on the next line takes the ; back', async ({ page, isMobile }) => {
    test.skip(isMobile, ANDROID_KEYS);
    await boot(page);
    await newProject(page, 'c', 'js');
    await openFile(page, 'main.js');
    await setText(page, '');
    await page.keyboard.type('fetch(url)');
    await press(page, 'Enter');
    await page.keyboard.type('.then(');
    expect(await editorText(page)).toBe('fetch(url)\n.then();');
  });

  test('JS files written without semicolons are left alone', async ({ page }) => {
    await boot(page);
    await newProject(page, 'n', 'empty');
    await writeProjectFile(page, 'a.js', "import x from 'x'\nconst a = 1\nconst b = 2\nfoo(a)\nbar(b)\n");
    await openFile(page, 'a.js');
    await page.evaluate(() => { const v = window.__app.ws.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); v.focus(); });
    await page.keyboard.type('const c = 3');
    expect(await editorText(page)).toMatch(/\nconst c = 3$/);
  });

  test('can be switched off in Settings', async ({ page }) => {
    await cppFile(page, 'int main() {\n    |\n}');
    await page.evaluate(() => window.__app.updateSettings({ autoSemicolons: false }));
    await page.evaluate(() => window.__app.ws.view.focus());
    await page.keyboard.type('int x = 5');
    expect(await editorText(page)).toBe('int main() {\n    int x = 5\n}');
  });
});

test.describe('complete statement', () => {
  test('Ctrl+Shift+Enter adds ; and starts a new line, or { } after an if', async ({ page }) => {
    await cppFile(page, 'int main() {\n    |\n}');
    await page.evaluate(() => window.__app.updateSettings({ autoSemicolons: false }));
    await page.evaluate(() => window.__app.ws.view.focus());
    await page.keyboard.type('int y = f(2');
    await press(page, `${mod}+Shift+Enter`);
    expect(await editorText(page)).toBe('int main() {\n    int y = f(2);\n    \n}');
    await page.keyboard.type('if (y > 0)');
    await press(page, `${mod}+Shift+Enter`);
    expect(await editorText(page)).toBe('int main() {\n    int y = f(2);\n    if (y > 0) {\n        \n    }\n}');
  });

  test('Python: adds the : after a block header', async ({ page }) => {
    await boot(page, { tabWidth: 4 });
    await newProject(page, 'py', 'empty');
    await writeProjectFile(page, 'a.py', '');
    await openFile(page, 'a.py');
    await setText(page, 'for i in range(3)');
    // the Python language (lazy-loaded) decides the indent after ":"
    await expect(page.locator('.pane.focused-pane .cm-line span').first()).toBeVisible();
    await page.evaluate(() => window.__app.run('completeStatement'));
    // the ":" is ours; the indent of the new line comes from the Python language
    expect(await editorText(page)).toMatch(/^for i in range\(3\):\n *$/);
  });
});

test.describe('HTML & CSS', () => {
  async function htmlFile(page, text) {
    await boot(page);
    await newProject(page, 'w', 'web');
    await openFile(page, 'index.html');
    await setText(page, text);
  }

  test('"!" + Tab expands the HTML5 boilerplate', async ({ page }) => {
    await htmlFile(page, '');
    await page.keyboard.type('!');
    await expect(page.locator('.cm-completionLabel', { hasText: '!' })).toBeVisible();
    await settle(page);
    await page.keyboard.press('Tab');
    const text = await editorText(page);
    expect(text).toMatch(/^<!DOCTYPE html>\n<html lang="en">/);
    expect(text).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    expect(text).toContain('<title>Document</title>');
  });

  test('ul>li*3 + Tab expands to nested tags', async ({ page }) => {
    await htmlFile(page, '<body>\n  \n</body>');
    await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 9 } }));
    await page.keyboard.type('ul>li*3');
    await expect(page.locator('.cm-completionLabel', { hasText: 'ul>li*3' })).toBeVisible();
    await settle(page);
    await page.keyboard.press('Tab');
    expect(await editorText(page)).toBe('<body>\n  <ul>\n    <li></li>\n    <li></li>\n    <li></li>\n  </ul>\n</body>');
    // the cursor is in the first <li>
    expect(await head(page)).toBe('<body>\n  <ul>\n    <li>'.length);
  });

  test('a tag name on a new line becomes a tag without typing "<"', async ({ page }) => {
    await htmlFile(page, '');
    await page.keyboard.type('section');
    await expect(page.locator('.cm-completionLabel', { hasText: 'section' }).first()).toBeVisible();
    await settle(page);
    await page.keyboard.press('Tab');
    expect(await editorText(page)).toBe('<section></section>');
    expect(await head(page)).toBe('<section>'.length);
  });

  test('typing "di" in text suggests div; Tab makes the tag', async ({ page }) => {
    await htmlFile(page, '<body>\n  \n</body>');
    await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 9 } }));
    await page.keyboard.type('di');
    await expect(page.locator('.cm-completionLabel').first()).toHaveText('div');
    await expect(page.locator('.cm-completionLabel', { hasText: 'dialog' })).toBeVisible();
    await settle(page);
    await page.keyboard.press('Tab');
    expect(await editorText(page)).toBe('<body>\n  <div></div>\n</body>');
    expect(await head(page)).toBe('<body>\n  <div>'.length);
  });

  test('lorem20 → 20 words of placeholder text; a keyboard capital "P" still suggests <p>', async ({ page }) => {
    await htmlFile(page, '<body>\n  \n</body>');
    await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 9 } }));
    await page.keyboard.type('lorem20');
    await expect(page.locator('.cm-completionLabel', { hasText: 'lorem20' })).toBeVisible();
    await settle(page);
    await page.keyboard.press('Tab');
    const words = (await editorText(page)).split('\n')[1].trim().split(/\s+/);
    expect(words.length).toBe(20);
    await setText(page, '<body>\n  \n</body>', 9);
    await page.keyboard.type('P');
    await expect(page.locator('.cm-completionLabel').first()).toHaveText('p');
    await settle(page);
    await page.keyboard.press('Tab');
    expect(await editorText(page)).toBe('<body>\n  <p></p>\n</body>');
  });

  test('in a sentence, tag suggestions show but Enter still starts a new line', async ({ page, isMobile }) => {
    test.skip(isMobile, ANDROID_KEYS);
    await htmlFile(page, '<p>Meet me at the');
    await page.evaluate(() => window.__app.ws.view.focus());
    await page.keyboard.type(' time');
    await expect(page.locator('.cm-completionLabel', { hasText: 'time' })).toBeVisible();
    await settle(page);
    await press(page, 'Enter');
    expect(await editorText(page)).toMatch(/^<p>Meet me at the time\n\s*$/);
  });

  test('no tag suggestions inside attribute values or capitalised words', async ({ page }) => {
    await htmlFile(page, '');
    await page.keyboard.type('<div class="di');
    await page.waitForTimeout(250);
    await expect(page.locator('.cm-completionIcon-tag')).toHaveCount(0);
    await setText(page, '<p>Meet me at the');
    await page.keyboard.type(' Table');
    await page.waitForTimeout(250);
    await expect(page.locator('.cm-completionIcon-tag')).toHaveCount(0);
  });

  test('renaming an open tag renames its closing tag', async ({ page, isMobile }) => {
    test.skip(isMobile, ANDROID_KEYS);
    await htmlFile(page, '<div class="a">hello</div>');
    // select "div" in the open tag and type a new name
    await page.evaluate(() => window.__app.ws.view.dispatch({ selection: { anchor: 1, head: 4 } }));
    await page.keyboard.type('section');
    expect(await editorText(page)).toBe('<section class="a">hello</section>');
    // delete the whole name and type another one: the link survives "<>"
    for (let i = 0; i < 'section'.length; i++) await page.keyboard.press('Backspace');
    expect(await editorText(page)).toBe('< class="a">hello</>');
    await page.keyboard.type('p');
    expect(await editorText(page)).toBe('<p class="a">hello</p>');
    // undo is one step per edit, both tags together
    await page.keyboard.press(`${mod}+z`);
    expect(await editorText(page)).not.toContain('</p>');
  });

  test('src="" suggests project files', async ({ page }) => {
    await htmlFile(page, '');
    await page.keyboard.type('<img src="');
    await expect(completionOpen(page)).toBeVisible();
    await expect(page.locator('.cm-completionLabel', { hasText: 'app.js' })).toBeVisible();
    await expect(page.locator('.cm-completionLabel', { hasText: 'style.css' })).toBeVisible();
  });

  test('CSS: m10 → margin: 10px;', async ({ page }) => {
    await boot(page);
    await newProject(page, 'css', 'web');
    await openFile(page, 'style.css');
    await setText(page, '.box {\n  \n}', 9);
    await page.keyboard.type('m10');
    await expect(page.locator('.cm-completionLabel', { hasText: 'm10' })).toBeVisible();
    await settle(page);
    await page.keyboard.press('Tab');
    expect(await editorText(page)).toBe('.box {\n  margin: 10px;\n}');
  });
});

test('words from other open files are suggested', async ({ page }) => {
  await boot(page);
  await newProject(page, 'words', 'empty');
  await writeProjectFile(page, 'lib.py', 'def computeTotalPrice(items):\n    return 0\n');
  await writeProjectFile(page, 'main.py', '');
  await openFile(page, 'lib.py');
  await openFile(page, 'main.py');
  await setText(page, '');
  await page.keyboard.type('computeT');
  const option = page.locator('.cm-tooltip-autocomplete li', { hasText: 'computeTotalPrice' });
  await expect(option).toBeVisible();
  await expect(option.locator('.cm-completionDetail')).toHaveText('lib.py');
});

test('suggestions show while a keyboard is still composing the word (Gboard-style)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drives desktop contenteditable composition through CDP');
  await boot(page);
  await newProject(page, 'ime', 'js');
  await openFile(page, 'main.js');
  await setText(page, 'const documentTitle = 1;\n');
  const cdp = await page.context().newCDPSession(page);
  for (const t of ['d', 'do', 'doc']) {
    await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
    await page.waitForTimeout(40);
  }
  await expect(page.locator('.cm-completionLabel', { hasText: 'documentTitle' })).toBeVisible({ timeout: 1500 });
  await cdp.send('Input.insertText', { text: 'doc' });
  expect(await editorText(page)).toBe('const documentTitle = 1;\ndoc');
});

test('import paths are suggested relative to the file', async ({ page }) => {
  await boot(page);
  await newProject(page, 'imp', 'empty');
  await writeProjectFile(page, 'src/utils/math.js', 'export const add = (a, b) => a + b;\n');
  await writeProjectFile(page, 'src/main.js', '');
  await openFile(page, 'src/main.js');
  await setText(page, '');
  await page.keyboard.type("import { add } from '");
  await expect(page.locator('.cm-completionLabel', { hasText: './utils/math.js' })).toBeVisible();
});
