// ui/settingsView.js — Settings as pages with a search box (ROADMAP 2.1).
//
// Opened over the workspace, like VS Code's Settings editor, and loaded the
// first time it is opened. Wide screens: the pages on the left, the open
// page on the right. Phones: the list of pages, then a page with ← Back;
// Android's Back button goes back too. The search box looks through every
// page (each setting row carries its words in data-search).

import { h, icon } from './dom.js';
import { confirm, prompt, toast, isModalOpen, showJson } from './overlays.js';
import { GESTURES, GESTURE_ACTIONS, DEFAULT_GESTURE_MAP, DEFAULTS, normalizeSettings, THEMES } from '../core/settings.js';
import { GestureRecognizer, presetOptions, describeDecision, gestureKey } from '../core/gestures.js';
import { BarEditor, SymbolSetsEditor, keysBarTransfer } from './keysBarEditor.js';
import { ShortcutsEditor } from './shortcutsEditor.js';

export const PAGES = [
  { id: 'appearance', title: 'Appearance', icon: 'eye', desc: 'Theme, code font size, interface size' },
  { id: 'editor', title: 'Editor', icon: 'edit', desc: 'Indentation, soft wrap, line numbers, brackets' },
  { id: 'typing', title: 'Typing & autocomplete', icon: 'format', desc: 'Semicolons, Emmet, keyboard input' },
  { id: 'keysbar', title: 'Keys bar', icon: 'keyboardHide', desc: 'Which keys, where; symbols per language' },
  { id: 'shortcuts', title: 'Keyboard shortcuts', icon: 'command', desc: 'For a Bluetooth or USB keyboard' },
  { id: 'gestures', title: 'Gestures', icon: 'gesture', desc: 'Swipes on the code, sensitivity, vibration' },
  { id: 'files', title: 'Files & saving', icon: 'save', desc: 'Autosave, hidden files, local history' },
  { id: 'run', title: 'Run', icon: 'play', desc: 'Time limit, preview' },
  { id: 'git', title: 'Git', icon: 'git', desc: 'Author, CORS proxy' },
  { id: 'snippets', title: 'Snippets', icon: 'copy', desc: 'Your own autocomplete snippets' },
  { id: 'about', title: 'About & diagnostics', icon: 'info', desc: 'Version, updates, storage, reset' },
];

const WIDE = '(min-width: 720px)';

/** "10 Oct 2026, 08:41" in the reader's own time zone. */
function formatBuilt(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const words = (...parts) => parts.filter(Boolean).join(' ').toLowerCase();

function row(label, desc, control, keywords = '') {
  return h('div.setting', { dataset: { search: words(label, desc, keywords) } },
    h('div.s-text', h('div.s-label', label), desc ? h('div.s-desc', desc) : null), control);
}

export class SettingsView {
  /**
   * @param {{get:()=>object, set:(patch:object)=>void, extras:object}} deps
   *   extras: version, built, checkUpdate, showShortcuts, showGestures,
   *   storageInfo, commands() → [{id, label, key}], profile() → keys-bar profile
   */
  constructor(deps) {
    this.deps = deps;
    this.page = null; // the open page; null = the list (phones)
    this.query = '';
    this.depth = 0;   // history entries this view added (1 open, 2 a page on a phone)
    this.search = h('input.input.sv-search', {
      type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
      oninput: () => { this.query = this.search.value.trim(); this.render(); },
    });
    this.backBtn = h('button.icon-btn.sv-back', { type: 'button', 'aria-label': 'Back', title: 'Back', icon: 'back', onclick: () => this.back() });
    this.title = h('h2.sv-title', 'Settings');
    this.nav = h('nav.sv-nav', { 'aria-label': 'Settings pages' });
    this.main = h('div.sv-main');
    this.el = h('div.settings-view', { role: 'dialog', 'aria-label': 'Settings', hidden: true },
      h('div.sv-head', this.backBtn, this.title, this.search,
        h('button.icon-btn.sv-close', { type: 'button', 'aria-label': 'Close settings', title: 'Close', icon: 'close', onclick: () => this.close() })),
      h('div.sv-body', this.nav, this.main));
    (document.getElementById('app') || document.body).append(this.el);
    window.addEventListener('popstate', () => this.onPopState());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.isOpen || isModalOpen() || e.defaultPrevented) return;
      e.preventDefault();
      if (this.query) { this.search.value = ''; this.query = ''; this.render(); } else this.back();
    });
    matchMedia(WIDE).addEventListener('change', () => { if (this.isOpen) this.render(); });
  }

  get isOpen() { return !this.el.hidden; }
  get wide() { return matchMedia(WIDE).matches; }

  /**
   * Opens Settings, at a page (id) or at the list. `returnTo`: where ← and
   * Android Back go from the list (the phone's drawer it was opened from);
   * ✕ always goes straight back to the code.
   */
  open(page = null, { returnTo = null } = {}) {
    if (!this.isOpen) {
      this.returnTo = returnTo;
      this.el.hidden = false;
      // Off the code: the soft keyboard and the keys bar go away.
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      history.pushState({ settingsView: 1 }, '');
      this.depth = 1;
    }
    this.search.value = '';
    this.query = '';
    this.show(page);
  }

  show(page) {
    if (page && !this.wide && this.depth === 1) { history.pushState({ settingsView: 2 }, ''); this.depth = 2; }
    this.page = page;
    this.render();
    this.main.scrollTop = 0;
  }

  /** ← / Esc / Android Back: search → page → list → closed. */
  back() {
    if (this.query) { this.search.value = ''; this.query = ''; this.render(); return; }
    if (this.depth > 0) history.back(); else this.hide();
  }

  close() {
    this.returnTo = null;
    if (this.depth > 0) { this.closing = true; history.go(-this.depth); } else this.hide();
  }

  onPopState() {
    if (!this.isOpen) return;
    if (this.closing || this.depth <= 1) { this.closing = false; this.depth = 0; this.hide(); return; }
    this.depth = 1;
    this.page = null;
    this.render();
  }

  hide() {
    this.el.hidden = true;
    this.page = null;
    const back = this.returnTo;
    this.returnTo = null;
    if (this.deps.onClose) this.deps.onClose();
    if (back) back();
  }

  // ---- drawing ------------------------------------------------------------

  render() {
    const wide = this.wide;
    const page = this.page || (wide ? PAGES[0].id : null);
    const searching = !!this.query;
    const info = PAGES.find((p) => p.id === page);
    this.el.dataset.view = searching ? 'search' : page ? 'page' : 'list';
    this.title.textContent = searching ? 'Search' : !wide && info ? info.title : 'Settings';
    this.backBtn.hidden = !(searching || (!wide && (page || this.returnTo)));
    const backLabel = !searching && !page && this.returnTo ? 'Back to the side panels' : 'Back';
    this.backBtn.title = backLabel;
    this.backBtn.setAttribute('aria-label', backLabel);
    this.nav.textContent = '';
    for (const p of PAGES) {
      this.nav.append(h('button.sv-nav-item', {
        type: 'button', 'aria-current': !searching && p.id === page ? 'page' : null,
        onclick: () => { this.search.value = ''; this.query = ''; this.show(p.id); },
      }, h('span.sv-nav-icon', { html: icon(p.icon, 20) }), h('span.sv-nav-text', h('span.sv-nav-title', p.title), h('span.sv-nav-desc', p.desc))));
    }
    this.main.textContent = '';
    if (searching) this.main.append(...this.results());
    else if (info) this.main.append(h('h3.sv-page-title', info.title), ...this.build(info.id));
  }

  /** Every setting matching the search words, under its page's name. */
  results() {
    const want = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const p of PAGES) {
      const els = this.build(p.id).flatMap((el) => (el.dataset && el.dataset.search != null ? [el] : el.querySelectorAll ? [...el.querySelectorAll('[data-search]')] : []));
      const hits = els.filter((el) => want.every((w) => el.dataset.search.includes(w)));
      const pageHit = want.every((w) => words(p.title, p.desc).includes(w));
      if (!hits.length && !pageHit) continue;
      out.push(h('button.sv-result-page', { type: 'button', onclick: () => { this.search.value = ''; this.query = ''; this.show(p.id); } }, `${p.title} ›`));
      for (const el of hits) {
        out.push(el.dataset.stub
          ? h('button.setting.sv-stub', { type: 'button', onclick: () => { this.search.value = ''; this.query = ''; this.show(p.id); } }, el.dataset.stub)
          : el);
      }
    }
    if (!out.length) out.push(h('p.sv-empty', `No setting matches “${this.query}”.`));
    return out;
  }

  /** The rows of a page (fresh elements, bound to the live settings). */
  build(id) {
    const s = this.deps.get();
    const set = (patch) => this.deps.set(patch);
    const select = (key, options, label, desc, kw) => row(label, desc,
      h('select.select', { 'aria-label': label, onchange: (e) => set({ [key]: e.target.value }) },
        Object.entries(options).map(([v, t]) => h('option', { value: v, selected: String(s[key]) === v }, t))), kw);
    const num = (key, label, desc, min, max, step = 1, kw) => row(label, desc,
      h('input.input', { type: 'number', min, max, step, value: s[key], 'aria-label': label, onchange: (e) => set({ [key]: Number(e.target.value) }) }), kw);
    const toggle = (key, label, desc, kw) => row(label, desc,
      h('label.switch', h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked: s[key], onchange: (e) => set({ [key]: e.target.checked }) }), h('span')), kw);
    const text = (key, label, desc, placeholder = '') => {
      const input = h('input.input', { type: 'text', value: s[key], placeholder, 'aria-label': label, spellcheck: 'false', autocapitalize: 'off', onchange: (e) => set({ [key]: e.target.value }) });
      return h('div.setting.stacked', { dataset: { search: words(label, desc) } }, h('div.s-text', h('div.s-label', label), desc ? h('div.s-desc', desc) : null), input);
    };
    const note = (t) => h('div.setting', { dataset: { search: words(t) } }, h('div.s-text', h('div.s-desc', t)));
    const heading = (t) => h('h4', t);
    const x = this.deps.extras;

    switch (id) {
      case 'appearance': return [
        select('theme', { system: 'Follow the phone (Dark / Light Modern)', ...THEMES }, 'Color theme', 'Like VS Code. Also in the command palette: "Color theme".', 'dark light colour color high contrast monokai'),
        num('fontSize', 'Code font size', 'Pinch the code with two fingers to change it quickly.', 8, 40, 1, 'zoom text'),
        select('uiZoom', Object.fromEntries([70, 80, 90, 100, 110, 120, 130, 140, 150, 160].map((v) => [v, `${v}%`])), 'Interface size',
          'Menus, tabs, side bar, panels and the keys bar. The code keeps its own font size.', 'zoom scale'),
        toggle('autoHideTitle', 'Hide the title bar while scrolling (phone)', 'Scrolling the code down slides it away for more room; scrolling up brings it back. Zen mode (command palette) hides everything but the code and the keys bar.', 'title bar autohide fullscreen zen immersive'),
      ];
      case 'editor': return [
        num('tabWidth', 'Indent size', 'Used when neither .editorconfig nor the file itself says otherwise.', 1, 8, 1, 'tab width spaces'),
        toggle('insertSpaces', 'Indent with spaces', null, 'tabs'),
        select('wrapDefault', { auto: 'Auto (on for narrow screens)', on: 'On', off: 'Off' }, 'Soft wrap for new tabs', 'Toggle per file from the status bar.', 'line wrapping'),
        toggle('lineNumbers', 'Line numbers', 'Tap a number to select the line; drag down the numbers to select several.', 'gutter'),
        toggle('autoCloseBrackets', 'Auto-close brackets and quotes', null, 'pairs parentheses'),
        toggle('stickyScroll', 'Sticky scroll', 'Keep the enclosing function/class header visible at the top.'),
        toggle('fastScroll', 'Fast-scroll thumb', 'A draggable handle on long files (touch screens).', 'scrollbar'),
        toggle('wordHighlight', 'Highlight the name under the cursor', 'With the cursor on a variable (or function, property…), its other uses are lightly highlighted. Strings and comments are skipped.', 'occurrences variable'),
        toggle('bracketPairColors', 'Colour bracket pairs', '( [ { and their partners get one colour per nesting level, as in VS Code. A closer with nothing to close is red.', 'brackets parentheses rainbow'),
        toggle('indentGuides', 'Indent guides', 'Thin vertical lines at each indentation level.', 'indentation lines'),
        toggle('formatOnSave', 'Format on save', 'Runs Prettier for JS/TS/CSS/HTML/JSON/Markdown/YAML.', 'prettier'),
      ];
      case 'typing': return [
        toggle('autoSemicolons', 'Automatic semicolons', 'C, C++, Java, C#, JS, TS: a faded ; appears after statements like "int x = " or "return ". Type ; or press Enter to keep it, Backspace right away to drop it. Off for JS files written without semicolons.', 'semicolon'),
        toggle('emmet', 'Emmet in HTML and CSS', '"!" → HTML page, "ul>li*3" → list, "div" on a new line → <div></div>, CSS "m10" → margin: 10px;', 'abbreviations autocomplete'),
        toggle('linkedTags', 'Rename matching HTML tag', 'Editing <div> also edits its </div>.', 'html'),
        toggle('androidEditContext', 'Android: EditContext keyboard input', 'Off (recommended): the classic input, which reliably turns off automatic capitals and autocorrect. On: Chrome\'s newer input API — try it only if letters get lost or doubled. Reloads the app.', 'capitals autocorrect gboard'),
        note('"Complete statement" (keys bar ⏎; or Ctrl+Shift+Enter) adds the missing ; — or : in Python, { } after if (…) — and starts a new line, whatever the settings above.'),
      ];
      case 'keysbar': return [
        select('keysBarMode', { auto: 'Auto (with the on-screen keyboard)', always: 'Always', never: 'Never' }, 'Coding keys bar', null, 'show hide'),
        heading('Layout'),
        new BarEditor({ get: this.deps.get, set, profile: x.profile ? x.profile() : 'phone' }).el,
        heading('Symbol keys per language'),
        new SymbolSetsEditor({ get: this.deps.get, set, profile: x.profile ? x.profile() : 'phone' }).el,
        heading('Share or start over'),
        keysBarTransfer({ get: this.deps.get, set, rerender: () => this.render() }),
      ];
      case 'shortcuts': return [new ShortcutsEditor({ get: this.deps.get, set, commands: x.commands }).el];
      case 'gestures': return [
        toggle('gesturesEnabled', 'Gestures on the code', 'Swipe right to autocomplete, and more — see the list below.', 'swipe'),
        toggle('gestureHints', 'Show a hint when a gesture runs'),
        select('gestureSensitivity', { strict: 'Strict (long, fast, straight)', normal: 'Normal', loose: 'Loose (short or slower swipes count)' }, 'Swipe sensitivity',
          'Strict if gestures trigger by accident, Loose if swipes are often missed. Try it on the pad below.'),
        h('div', { dataset: { search: 'gesture test pad try swipe', stub: 'Gesture test pad ›' } }, this.gestureTestPad()),
        h('div.gesture-table', { dataset: { search: words('gestures actions map', ...Object.values(GESTURES)), stub: 'What each gesture does ›' } }, Object.entries(GESTURES).flatMap(([key, label]) => [
          h('span.g-name', label),
          h('select.select', { 'aria-label': label, onchange: (e) => set({ gestureMap: { ...this.deps.get().gestureMap, [key]: e.target.value } }) },
            Object.entries(GESTURE_ACTIONS).map(([v, t]) => h('option', { value: v, selected: s.gestureMap[key] === v }, t))),
        ])),
        h('div.setting', { dataset: { search: 'reset gestures guide' } },
          h('button.btn.btn-small', { type: 'button', onclick: () => { set({ gestureMap: { ...DEFAULT_GESTURE_MAP } }); this.render(); } }, 'Reset gestures'),
          h('button.btn.btn-small', { type: 'button', onclick: () => x.showGestures() }, 'Gesture guide')),
        toggle('haptics', 'Vibrate on keys and gestures', null, 'haptic feedback vibration'),
      ];
      case 'files': return [
        select('autosave', { off: 'Off', delay: 'After a pause in typing', blur: 'When leaving the app' }, 'Autosave', 'Unsaved work is always mirrored for crash recovery, whatever you choose here.', 'save'),
        num('autosaveDelay', 'Autosave delay (ms)', null, 300, 60000, 100),
        text('ignoreList', 'Hidden & ignored names', 'Hidden in the file tree and skipped by search / quick open (along with .gitignore).', DEFAULTS.ignoreList),
        num('historyDays', 'Keep local history (days)', null, 1, 90, 1, 'snapshots'),
        num('historyMaxPerFile', 'Snapshots per file', null, 5, 500, 1, 'local history'),
      ];
      case 'run': return [
        num('runTimeLimit', 'Time limit (seconds)', 'Runs are stopped after this long. The Stop button always works too.', 1, 300, 1, 'timeout'),
        select('previewPlacement', { auto: 'Auto (side on wide screens)', bottom: 'Bottom panel', side: 'Beside the editor' }, 'Preview position', null, 'html markdown'),
        toggle('previewAutoRefresh', 'Refresh preview while typing', null, 'live'),
      ];
      case 'git': return [
        text('gitAuthorName', 'Author name'),
        text('gitAuthorEmail', 'Author email'),
        text('gitCorsProxy', 'CORS proxy for push / pull / clone', 'Browsers can\'t talk to GitHub\'s git servers directly. Requests go through this proxy. Leave empty in the Android app if you add a native HTTP plugin.'),
      ];
      case 'snippets': return [this.snippetsEditor(s, set)];
      case 'about': return this.aboutPage(set);
      default: return [];
    }
  }

  aboutPage(set) {
    const x = this.deps.extras;
    const storage = h('div.s-desc', 'Storage: …');
    x.storageInfo().then((t) => { storage.textContent = t; });
    const updateLine = h('div.s-desc.update-line', { 'aria-live': 'polite' });
    return [
      h('div.setting', { dataset: { search: 'version build storage about' } }, h('div.s-text',
        h('div.s-label.app-version', `CodeEditor ${x.version}`),
        h('div.s-desc', x.built ? `Built ${formatBuilt(x.built)}` : 'Development build'),
        storage)),
      x.checkUpdate && h('div.setting', { dataset: { search: 'check for updates new version' } }, h('div.s-text',
        h('button.btn.btn-small', { type: 'button', onclick: () => this.checkUpdate(updateLine) }, 'Check for updates'), updateLine)),
      h('div.setting', { dataset: { search: 'keyboard shortcuts list gesture guide' } },
        h('button.btn.btn-small', { type: 'button', onclick: () => x.showShortcuts() }, 'Keyboard shortcuts'),
        h('button.btn.btn-small', { type: 'button', onclick: () => x.showGestures() }, 'Gesture guide')),
      h('div.setting', { dataset: { search: 'export import backup all settings json' } },
        h('div.s-text', h('div.s-label', 'All settings as JSON'), h('div.s-desc', 'To move them to another phone or browser.')),
        h('button.btn.btn-small', { type: 'button', onclick: () => showJson('Settings', this.deps.get()) }, 'Export'),
        h('button.btn.btn-small', { type: 'button', onclick: () => this.importAll() }, 'Import')),
      h('div.setting', { dataset: { search: 'credits licence license icons codicons material open source' } }, h('div.s-text',
        h('div.s-label', 'Credits'),
        h('div.s-desc.credits',
          'Interface icons: ', h('a', { href: 'https://github.com/microsoft/vscode-codicons', target: '_blank', rel: 'noopener' }, 'Codicons'),
          ' by Microsoft, licensed under ', h('a', { href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank', rel: 'noopener' }, 'CC BY 4.0'),
          ' (numbers rounded, a subset). File icons: ', h('a', { href: 'https://github.com/material-extensions/vscode-material-icon-theme', target: '_blank', rel: 'noopener' }, 'Material Icon Theme'),
          ' (MIT). Editor: CodeMirror (MIT).'))),
      h('div.setting', { dataset: { search: 'reset all settings defaults' } },
        h('button.btn.btn-small.btn-danger', { type: 'button', onclick: async () => {
          if (await confirm('Reset all settings?', 'Your files are not affected.', 'Reset', 'danger')) { set({ ...DEFAULTS, __reset: true }); this.render(); }
        } }, 'Reset settings')),
    ];
  }

  async importAll() {
    const text = await prompt({ title: 'Import settings', label: 'Paste the exported JSON', multiline: true, okLabel: 'Import' });
    if (!text) return;
    let raw;
    try { raw = JSON.parse(text); } catch { toast('That is not valid JSON.', 'error'); return; }
    this.deps.set(normalizeSettings({ ...this.deps.get(), ...raw }));
    toast('Settings imported.', 'success');
    this.render();
  }

  async checkUpdate(line) {
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
    const ta = h('textarea.input.input-multiline', { rows: 8, 'aria-label': 'User snippets JSON', spellcheck: 'false', autocapitalize: 'off',
      placeholder: '{\n  "javascript": [\n    { "label": "hello", "body": "console.log(\'hello ${1:name}\');", "detail": "my snippet" }\n  ],\n  "*": []\n}' });
    ta.value = s.userSnippets;
    ta.addEventListener('change', () => set({ userSnippets: ta.value }));
    return h('div.setting.stacked', { dataset: { search: 'snippets json autocomplete templates' } },
      h('div.s-desc', 'Your own snippets as JSON, keyed by language id (javascript, python, html, css, cpp…, or "*" for all). They show up in autocomplete; swipe right / Tab moves between ${1:fields}.'), ta);
  }
}
