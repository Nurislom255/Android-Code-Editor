// ui/settingsPanel.js — every setting, applied live and saved immediately.

import { h } from './dom.js';
import { GESTURES, GESTURE_ACTIONS, DEFAULT_GESTURE_MAP, DEFAULTS } from '../core/settings.js';
import { DEFAULT_LAYOUTS } from '../core/keysLayout.js';
import { confirm } from './overlays.js';
import { GestureRecognizer, presetOptions, describeDecision, gestureKey } from '../core/gestures.js';

const LAYOUT_NAMES = { js: 'JavaScript / TypeScript', html: 'HTML / XML', css: 'CSS', python: 'Python', clike: 'C / C++ / Java / Kotlin', markdown: 'Markdown', json: 'JSON', plain: 'Other files' };

/** "10 Oct 2026, 08:41" in the reader's own time zone. */
function formatBuilt(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export class SettingsPanel {
  /**
   * @param {HTMLElement} el
   * @param {{get:()=>object, set:(patch:object)=>void, extras:{showShortcuts, showGestures, storageInfo:()=>Promise<string>, version:string}}} deps
   */
  constructor(el, deps) {
    this.el = el;
    this.deps = deps;
    this.body = h('div.panel-scroll.settings');
    el.append(h('div.panel-header', h('span.title', 'Settings')), this.body);
  }

  render() {
    const s = this.deps.get();
    const set = (patch) => this.deps.set(patch);
    const b = this.body;
    b.textContent = '';

    const select = (key, options, label, desc) => {
      const sel = h('select.select', { 'aria-label': label, onchange: (e) => set({ [key]: e.target.value }) },
        Object.entries(options).map(([v, t]) => h('option', { value: v, selected: String(s[key]) === v }, t)));
      return row(label, desc, sel);
    };
    const num = (key, label, desc, min, max, step = 1) => {
      const input = h('input.input', { type: 'number', min, max, step, value: s[key], 'aria-label': label,
        onchange: (e) => set({ [key]: Number(e.target.value) }) });
      return row(label, desc, input);
    };
    const toggle = (key, label, desc) => {
      const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked: s[key], onchange: (e) => set({ [key]: e.target.checked }) });
      return row(label, desc, h('label.switch', input, h('span')));
    };
    const text = (key, label, desc, placeholder = '') => {
      const input = h('input.input', { type: 'text', value: s[key], placeholder, 'aria-label': label, spellcheck: 'false', autocapitalize: 'off',
        onchange: (e) => set({ [key]: e.target.value }) });
      return h('div.setting.stacked', h('div.s-text', h('div.s-label', label), desc ? h('div.s-desc', desc) : null), input);
    };

    b.append(
      h('h4', 'Appearance'),
      select('theme', { system: 'Follow system', dark: 'Dark', light: 'Light' }, 'Theme'),
      num('fontSize', 'Code font size', 'Pinch the code with two fingers to change it quickly.', 8, 40),
      select('uiZoom', Object.fromEntries([70, 80, 90, 100, 110, 120, 130, 140, 150, 160].map((v) => [v, `${v}%`])), 'Interface size',
        'Menus, tabs, side bar, panels and the keys bar. The code keeps its own font size.'),

      h('h4', 'Editor'),
      num('tabWidth', 'Indent size', 'Used when neither .editorconfig nor the file itself says otherwise.', 1, 8),
      toggle('insertSpaces', 'Indent with spaces'),
      select('wrapDefault', { auto: 'Auto (on for narrow screens)', on: 'On', off: 'Off' }, 'Soft wrap for new tabs', 'Toggle per file from the status bar.'),
      toggle('lineNumbers', 'Line numbers', 'Tap a number to select the line; drag down the numbers to select several.'),
      toggle('autoCloseBrackets', 'Auto-close brackets and quotes'),
      toggle('stickyScroll', 'Sticky scroll', 'Keep the enclosing function/class header visible at the top.'),
      toggle('fastScroll', 'Fast-scroll thumb', 'A draggable handle on long files (touch screens).'),
      toggle('formatOnSave', 'Format on save', 'Runs Prettier for JS/TS/CSS/HTML/JSON/Markdown/YAML.'),

      h('h4', 'Typing'),
      toggle('autoSemicolons', 'Automatic semicolons', 'C, C++, Java, C#, JS, TS: a faded ; appears after statements like "int x = " or "return ". Type ; or press Enter to keep it, Backspace right away to drop it. Off for JS files written without semicolons.'),
      toggle('emmet', 'Emmet in HTML and CSS', '"!" → HTML page, "ul>li*3" → list, "div" on a new line → <div></div>, CSS "m10" → margin: 10px;'),
      toggle('linkedTags', 'Rename matching HTML tag', 'Editing <div> also edits its </div>.'),
      toggle('androidEditContext', 'Android: EditContext keyboard input', 'Off (recommended): the classic input, which reliably turns off automatic capitals and autocorrect. On: Chrome\'s newer input API — try it only if letters get lost or doubled. Reloads the app.'),
      h('div.setting', h('div.s-text', h('div.s-desc', '"Complete statement" (keys bar ⏎; or Ctrl+Shift+Enter) adds the missing ; — or : in Python, { } after if (…) — and starts a new line, whatever the setting above.'))),

      h('h4', 'Saving'),
      select('autosave', { off: 'Off', delay: 'After a pause in typing', blur: 'When leaving the app' }, 'Autosave', 'Unsaved work is always mirrored for crash recovery, whatever you choose here.'),
      num('autosaveDelay', 'Autosave delay (ms)', null, 300, 60000, 100),

      h('h4', 'Touch & gestures'),
      toggle('gesturesEnabled', 'Gestures on the code', 'Swipe right to autocomplete, and more — see the list below.'),
      toggle('gestureHints', 'Show a hint when a gesture runs'),
      select('gestureSensitivity', { strict: 'Strict (long, fast, straight)', normal: 'Normal', loose: 'Loose (short or slower swipes count)' }, 'Swipe sensitivity',
        'Strict if gestures trigger by accident, Loose if swipes are often missed. Try it on the pad below.'),
      this.gestureTestPad(),
      h('div.gesture-table', Object.entries(GESTURES).flatMap(([key, label]) => [
        h('span.g-name', label),
        h('select.select', { 'aria-label': label, onchange: (e) => set({ gestureMap: { ...this.deps.get().gestureMap, [key]: e.target.value } }) },
          Object.entries(GESTURE_ACTIONS).map(([v, t]) => h('option', { value: v, selected: s.gestureMap[key] === v }, t))),
      ])),
      h('div.setting', h('button.btn.btn-small', { type: 'button', onclick: () => set({ gestureMap: { ...DEFAULT_GESTURE_MAP } }) }, 'Reset gestures'),
        h('button.btn.btn-small', { type: 'button', onclick: () => this.deps.extras.showGestures() }, 'Gesture guide')),
      toggle('haptics', 'Vibrate on keys and gestures'),
      select('keysBarMode', { auto: 'Auto (with the on-screen keyboard)', always: 'Always', never: 'Never' }, 'Coding keys bar'),
      h('div.setting.stacked', h('div.s-text', h('div.s-label', 'Symbol keys per language'),
        h('div.s-desc', 'Space-separated keys. "(^)" means tap → "(", swipe up or hold → ")".'))),
      ...Object.keys(DEFAULT_LAYOUTS).map((g) => {
        const ta = h('textarea.input.input-multiline', { rows: 2, 'aria-label': `Keys for ${LAYOUT_NAMES[g]}`, style: { minHeight: '56px' }, spellcheck: 'false', autocapitalize: 'off',
          onchange: (e) => set({ keysLayouts: { ...this.deps.get().keysLayouts, [g]: e.target.value } }) });
        ta.value = s.keysLayouts[g];
        return h('div.setting.stacked', h('div.s-desc', LAYOUT_NAMES[g],
          h('button.btn.btn-small.btn-ghost', { type: 'button', style: { marginLeft: '8px' }, onclick: () => { set({ keysLayouts: { ...this.deps.get().keysLayouts, [g]: DEFAULT_LAYOUTS[g] } }); this.render(); } }, 'Reset')), ta);
      }),

      h('h4', 'Running code'),
      num('runTimeLimit', 'Time limit (seconds)', 'Runs are stopped after this long. The Stop button always works too.', 1, 300),
      select('previewPlacement', { auto: 'Auto (side on wide screens)', bottom: 'Bottom panel', side: 'Beside the editor' }, 'Preview position'),
      toggle('previewAutoRefresh', 'Refresh preview while typing'),

      h('h4', 'Files'),
      text('ignoreList', 'Hidden & ignored names', 'Hidden in the file tree and skipped by search / quick open (along with .gitignore).', DEFAULTS.ignoreList),
      num('historyDays', 'Keep local history (days)', null, 1, 90),
      num('historyMaxPerFile', 'Snapshots per file', null, 5, 500),

      h('h4', 'Git'),
      text('gitAuthorName', 'Author name'),
      text('gitAuthorEmail', 'Author email'),
      text('gitCorsProxy', 'CORS proxy for push / pull / clone', 'Browsers can\'t talk to GitHub\'s git servers directly. Requests go through this proxy. Leave empty in the Android app if you add a native HTTP plugin.'),

      h('h4', 'Snippets'),
      this.snippetsEditor(s, set),

      h('h4', 'About'),
      h('div.setting', h('div.s-text',
        h('div.s-label.app-version', `CodeEditor ${this.deps.extras.version}`),
        h('div.s-desc', this.deps.extras.built ? `Built ${formatBuilt(this.deps.extras.built)}` : 'Development build'),
        this.storageLine = h('div.s-desc', 'Storage: …'))),
      this.deps.extras.checkUpdate && h('div.setting', h('div.s-text',
        h('button.btn.btn-small', { type: 'button', onclick: () => this.checkUpdate() }, 'Check for updates'),
        this.updateLine = h('div.s-desc.update-line', { 'aria-live': 'polite' }))),
      h('div.setting', h('button.btn.btn-small', { type: 'button', onclick: () => this.deps.extras.showShortcuts() }, 'Keyboard shortcuts'),
        h('button.btn.btn-small.btn-danger', { type: 'button', onclick: async () => {
          if (await confirm('Reset all settings?', 'Your files are not affected.', 'Reset', 'danger')) { this.deps.set({ ...DEFAULTS, __reset: true }); this.render(); }
        } }, 'Reset settings')),
    );
    this.deps.extras.storageInfo().then((t) => { if (this.storageLine) this.storageLine.textContent = t; });
  }

  async checkUpdate() {
    const line = this.updateLine;
    line.textContent = 'Checking…';
    const r = await this.deps.extras.checkUpdate();
    if (!line.isConnected) return;
    if (r.error) line.textContent = 'Could not reach the website (offline?).';
    else if (r.upToDate) line.textContent = 'This is the latest version.';
    else {
      const v = `Version ${r.latest.version} (built ${formatBuilt(r.latest.built)})`;
      line.textContent = r.ready ? `${v} is ready: tap Reload in the message below.`
        : r.hasWorker ? `${v} is on the website. Downloading it; a Reload button appears when it's ready.`
          : `${v} is on the website. Reload the page to get it.`;
    }
  }

  /** A touch area that reports how each swipe was read (and why not). */
  gestureTestPad() {
    const out = h('div.gesture-pad-result', { 'aria-live': 'polite' }, 'Swipe here with one or two fingers.');
    const pad = h('div.gesture-pad', h('div.gesture-pad-label', 'Gesture test pad'), out);
    const r = new GestureRecognizer({}, () => ({ width: window.innerWidth, height: window.innerHeight }));
    const pts = (e) => [...e.changedTouches].map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
    pad.addEventListener('touchstart', (e) => {
      if (!r.active) r.setOptions(presetOptions(this.deps.get().gestureSensitivity));
      for (const p of pts(e)) r.pointerDown(p.id, p.x, p.y, e.timeStamp);
    }, { passive: true });
    pad.addEventListener('touchmove', (e) => {
      if (e.cancelable) e.preventDefault();
      r.pointerMoves(pts(e), e.timeStamp);
    }, { passive: false });
    const end = (e) => {
      for (const p of pts(e)) {
        const before = r.lastDecision;
        r.pointerUp(p.id, p.x, p.y, e.timeStamp);
        if (r.lastDecision === before) continue;
        const d = r.lastDecision;
        const key = d.gesture ? gestureKey(d.gesture) : null;
        const action = key && this.deps.get().gestureMap[key];
        out.textContent = describeDecision(d) + (action ? ` → ${GESTURE_ACTIONS[action]}` : '');
        out.classList.toggle('ok', !!d.gesture);
      }
    };
    pad.addEventListener('touchend', end, { passive: true });
    pad.addEventListener('touchcancel', end, { passive: true });
    return pad;
  }

  snippetsEditor(s, set) {
    const ta = h('textarea.input.input-multiline', { rows: 6, 'aria-label': 'User snippets JSON', spellcheck: 'false', autocapitalize: 'off',
      placeholder: '{\n  "javascript": [\n    { "label": "hello", "body": "console.log(\'hello ${1:name}\');", "detail": "my snippet" }\n  ],\n  "*": []\n}' });
    ta.value = s.userSnippets;
    ta.addEventListener('change', () => set({ userSnippets: ta.value }));
    return h('div.setting.stacked', h('div.s-desc', 'Your own snippets as JSON, keyed by language id (javascript, python, html, css, cpp…, or "*" for all). They show up in autocomplete; swipe right / Tab moves between ${1:fields}.'), ta);
  }
}

function row(label, desc, control) {
  return h('div.setting', h('div.s-text', h('div.s-label', label), desc ? h('div.s-desc', desc) : null), control);
}
