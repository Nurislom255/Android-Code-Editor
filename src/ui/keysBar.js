// ui/keysBar.js — the coding keys above the soft keyboard (spec §3.1,
// ROADMAP Phase 2). Built for two thumbs; no row scrolls sideways.
//
// Phone, portrait (two rows of 7):
//   [Mod][ctx][ctx][ctx][ctx][ ⫶ ][ ⋯ ]    context row: keys for where the cursor is
//   [Tab][ ◉ ][ s1][ s2][ s3][ ↵ ][ ↶ ]    main row
// Phone, landscape: one row. Tablet: one row, two clusters at the corners
//   [Esc][Tab][ ◉ ][Ctrl][Shift][Alt]   …   [ctx×6][s1…s6][↵][⫶][↶][↷][⋯]
//
//   Tab   tap Tab · hold Shift+Tab
//   ◉     joystick: drag moves the cursor (further from the start = faster),
//         tap selects the word, hold then drag selects, flick ←/→ = line start/end
//   s1…   symbols of the language: tap · swipe up / down = variants · hold = all
//   ↵     tap new line · swipe up / down moves the line (hold to repeat) ·
//         hold opens the line fan: ⏎; ↥ Dup Join ✕ //
//   ⫶     tap adds a cursor below · swipe up above · hold: ⫶ Sel+ Sel* Esc
//   ↶     tap Undo · hold Redo
//   Mod   the context row becomes [Ctrl][Shift][Alt][Esc][⇧Tab][⏎;];
//         Ctrl then offers its shortcuts (S Save, F Find, D, A, /, G, P, X, C, V…).
//         Modifiers are one-shot (next key only); a double tap locks them.
//   ⋯     every key, grouped
//
// A soft keyboard's own letters can't be combined with a virtual Ctrl (the
// keyboard app sends composed text), so the modifiers only apply to keys
// here; Ctrl's shortcuts are offered as keys instead.
//
// Keys act on pointer *up*; `preventDefault()` on pointer down keeps the
// focus (and the soft keyboard) in the editor.

import { h, icon, haptic, isTouchDevice } from './dom.js';
import {
  parseLayout, parseToken, groupForLanguage, DEFAULT_LAYOUTS, classifyKeyDrag, stableSlots, keysProfile,
  ACTION_KEYS, MORE_GROUPS, CTRL_KEYS,
} from '../core/keysLayout.js';
import { contextKeys, parseTextKey, keyLabel } from '../core/contextKeys.js';
import { situationAt } from '../editor/keysContext.js';
import { escapable, atLineEdge } from '../editor/editActions.js';
import { EditorSelection } from '@codemirror/state';

const SWIPE_PX = 18;         // a swipe on a key
const SWIPES = { up: 0, down: 1, left: 2, right: 3 }; // → which variant (and corner hint)
const LONG_PRESS = 380;      // ms: hold
const REPEAT_EVERY = 55;     // ms: held key repeating (Backspace)
const SWIPE_REPEAT = 230;    // ms: held swipe repeating (move line)
// Joystick
const JOY_STEP_X = 11;       // px of (accelerated) drag per character
const JOY_STEP_Y = 20;       // … per line
const JOY_LOCK = 10;         // px before the drag picks a direction
const JOY_TURN = 36;         // px off that direction to change it
const JOY_FAST = 72;         // resting further out than this keeps the cursor moving…
const JOY_DWELL = 300;       // …after this many ms out there
const JOY_FLICK = 56;        // a quick flick this long: line start / end
const JOY_WALL = 450;        // ms of pushing past a line's end before the cursor wraps to the next line
const CTX_SLOTS = { phone: 4, landscape: 4, tablet: 6 };
const SYM_SLOTS = { phone: 3, landscape: 3, tablet: 6 };
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

export class KeysBar {
  /**
   * @param {HTMLElement} el
   * @param {{getView:()=>any, getSettings:()=>object, run:(name:string)=>any, arrow:(dir:string, mods:object)=>void,
   *          type:(text:string)=>void, describe?:(name:string)=>{label:string, key?:string}|null,
   *          isEscapable?:()=>boolean, onLayoutChange?:()=>void}} deps
   */
  constructor(el, deps) {
    this.el = el;
    this.deps = deps;
    this.langId = 'plaintext';
    this.group = 'plain';
    this.mods = { shift: 0, ctrl: 0, alt: 0 }; // 0 off, 1 one-shot, 2 locked
    this.layer = 'main';                      // 'main' | 'mod' | 'ctrl'
    this.sheetOpen = false;
    this.ctx = [];                            // context slot ids
    this.ctxEls = [];
    this.pressing = 0;
    this.presses = new Set(); // stop() of every press in progress
    this.keyboardOpen = false;
    this.editorFocused = false;
    this.profile = this.detectProfile();
    // After a tap the browser also sends a "click" — to whatever key is under
    // the finger by then, which may be a new one (the row was rebuilt). Clicks
    // only count without a recent touch anywhere on the bar.
    this.pointerAt = 0;
    const touched = () => { this.pointerAt = Date.now(); };
    el.addEventListener('pointerdown', touched, true);
    el.addEventListener('pointerup', touched, true);
    this.render();
    this.watchKeyboard();
  }

  // ---- visibility ---------------------------------------------------------

  watchKeyboard() {
    const vv = window.visualViewport;
    // The tallest height seen *for each window width*. A soft keyboard never
    // changes the width; rotating, split-screen or resizing the window does,
    // and then needs a new baseline — reusing the old one made a shorter
    // window look like an open keyboard, so the bar never went away.
    this.baseline = new Map();
    const measure = () => {
      const w = Math.round(window.innerWidth);
      // With interactive-widget=resizes-content the layout height shrinks with
      // the keyboard; the visual viewport also shrinks when the page is
      // pinch-zoomed, so its height is scaled back first.
      const height = Math.min(window.innerHeight, vv ? vv.height * vv.scale : Infinity);
      const base = Math.max(this.baseline.get(w) || 0, height);
      this.baseline.set(w, base);
      // A keyboard takes well over 120 px; browser bars appearing don't.
      this.keyboardOpen = isTouchDevice() && base - height > Math.max(120, base * 0.18);
      const p = this.detectProfile();
      if (p !== this.profile) { this.profile = p; this.render(); }
      this.update();
    };
    window.addEventListener('resize', measure);
    if (vv) vv.addEventListener('resize', measure);
    window.addEventListener('orientationchange', () => setTimeout(measure, 300));
    if (navigator.virtualKeyboard && navigator.virtualKeyboard.addEventListener) navigator.virtualKeyboard.addEventListener('geometrychange', measure);
    measure();
    document.addEventListener('focusin', (e) => {
      this.editorFocused = !!(e.target.closest && e.target.closest('.cm-content'));
      setTimeout(measure, 320);
      this.update();
    });
    document.addEventListener('focusout', () => {
      // Wait: focus may be moving to another editor.
      setTimeout(() => {
        const a = document.activeElement;
        this.editorFocused = !!(a && a.closest && a.closest('.cm-content'));
        this.update();
      }, 60);
    });
  }

  detectProfile() {
    return keysProfile({ screenWidth: window.screen.width, screenHeight: window.screen.height, touch: isTouchDevice() });
  }

  get visible() { return !this.el.classList.contains('hidden'); }

  update() {
    const s = this.deps.getSettings();
    const hasEditor = !!this.deps.getView();
    let show;
    if (s.keysBarMode === 'never' || !hasEditor) show = false;
    else if (s.keysBarMode === 'always') show = true;
    else show = isTouchDevice() && this.editorFocused && this.keyboardOpen;
    if (this.visible === show) return;
    this.el.classList.toggle('hidden', !show);
    if (show) this.updateContext(true);
    // The bar is part of the flex layout: the editor shrinks to make room,
    // so nothing ends up hidden behind it.
    requestAnimationFrame(() => this.deps.onLayoutChange && this.deps.onLayoutChange());
  }

  setLanguage(langId) {
    this.langId = langId || 'plaintext';
    const g = groupForLanguage(this.langId);
    if (g !== this.group) { this.group = g; this.ctx = []; this.render(); }
    else this.updateContext(true);
  }

  /** Called when Settings change (layouts, haptics). */
  refresh() {
    this.ctx = [];
    this.render();
    this.update();
  }

  /**
   * The editor changed (selection or text). Context keys only change at a
   * word boundary or after a short pause in typing, and never under a finger.
   */
  editorChanged(docChanged = false) {
    if (!this.visible) return;
    clearTimeout(this.ctxTimer);
    const view = this.deps.getView();
    if (docChanged && view) {
      const head = view.state.selection.main.head;
      if (/\w/.test(view.state.sliceDoc(head - 1, head))) { this.ctxTimer = setTimeout(() => this.updateContext(), 150); return; }
    }
    this.updateContext();
  }

  // ---- layout -------------------------------------------------------------

  symbols() {
    const s = this.deps.getSettings();
    const layout = (s.keysLayouts && s.keysLayouts[this.group]) || DEFAULT_LAYOUTS[this.group] || DEFAULT_LAYOUTS.plain;
    return layout.trim().split(/\s+/).filter(Boolean);
  }

  render() {
    // Every key is rebuilt: presses on the old ones are over (a repeating
    // key or the joystick would otherwise keep going with no finger up to come).
    for (const stop of [...this.presses]) stop();
    this.presses.clear();
    this.pressing = 0;
    this.el.textContent = '';
    this.el.dataset.profile = this.profile;
    this.ctxEls = [];
    if (this.sheetOpen) this.el.append(this.sheet());
    const syms = this.symbols();
    const nSym = SYM_SLOTS[this.profile];
    const symKeys = syms.slice(0, nSym).map((t) => this.key(this.symbolSpec(t)));
    const region = this.region();
    const K = (spec) => this.key(spec);
    if (this.profile === 'phone') {
      this.el.append(
        h('div.keys-row.keys-context', { role: 'toolbar', 'aria-label': 'Context keys' }, ...region),
        h('div.keys-row.keys-main', { role: 'toolbar', 'aria-label': 'Main keys' },
          K(this.tabSpec()), this.joystick(), ...symKeys, K(this.lineSpec()), K(this.undoSpec())),
      );
    } else if (this.profile === 'landscape') {
      this.el.append(h('div.keys-row.keys-single', { role: 'toolbar', 'aria-label': 'Coding keys' },
        K(this.tabSpec()), this.joystick(), ...region,
        ...(this.layer === 'main' ? symKeys : []), K(this.lineSpec()), K(this.cursorsSpec()), K(this.undoSpec()), K(this.moreSpec())));
    } else {
      const left = [K(this.actionSpec('escape')), K(this.tabSpec()), this.joystick(),
        K(this.modifierSpec('ctrl')), K(this.modifierSpec('shift')), K(this.modifierSpec('alt'))];
      const right = this.mods.ctrl ? [h('div.keys-region', ...this.ctrlKeys().map(K))]
        : [...region, ...symKeys];
      this.el.append(h('div.keys-row.keys-single', { role: 'toolbar', 'aria-label': 'Coding keys' },
        h('div.keys-cluster', ...left), h('div.keys-gap'),
        h('div.keys-cluster.keys-right', ...right, K(this.lineSpec()), K(this.cursorsSpec()), K(this.undoSpec()), K(this.moreSpec()))));
    }
    this.renderMods();
    this.updateContext(true);
  }

  /** The changing part: context keys, or the modifier / Ctrl layer. */
  region() {
    const K = (spec) => this.key(spec);
    if (this.profile === 'tablet') return this.contextSlots();
    if (this.layer === 'ctrl') {
      return [K(this.modifierSpec('ctrl', { active: true })), h('div.keys-region', ...this.ctrlKeys().map(K))];
    }
    if (this.layer === 'mod') {
      // (Shift+Tab and ⏎; are on Tab and ↵ already: Home / End instead)
      return [K(this.modSpec(true)), K(this.modifierSpec('ctrl')), K(this.modifierSpec('shift')), K(this.modifierSpec('alt')),
        K(this.actionSpec('escape')), K(this.navSpec('home')), K(this.navSpec('end'))];
    }
    const slots = this.contextSlots();
    return this.profile === 'phone'
      ? [K(this.modSpec(false)), ...slots, K(this.cursorsSpec()), K(this.moreSpec())]
      : [K(this.modSpec(false)), ...slots];
  }

  contextSlots() {
    const n = CTX_SLOTS[this.profile];
    const out = [];
    for (let i = 0; i < n; i++) {
      const btn = this.key({ label: '', title: '', tap: () => {} }, 'ctx');
      this.ctxEls.push(btn);
      out.push(btn);
    }
    return out;
  }

  /** Fills the context slots for where the cursor is (stable: a key that stays keeps its slot). */
  updateContext(force = false) {
    if (!this.ctxEls.length || (!this.visible && !force)) return;
    if (this.pressing) { this.ctxPending = true; return; }
    const view = this.deps.getView();
    let next = [];
    if (view) {
      const sit = situationAt(view.state, this.langId);
      const esc = this.profile !== 'tablet' && (escapable(view.state) || (this.deps.isEscapable && this.deps.isEscapable()));
      next = [...(esc ? ['@escape'] : []), ...contextKeys(sit).map((k) => (k.startsWith('@') ? k : `t:${k}`))];
    }
    // Room left: the language's next symbols.
    const syms = this.symbols();
    for (const t of syms.slice(SYM_SLOTS[this.profile])) next.push(`s:${t}`);
    // Nothing twice: not what the main row has ("()" when "(" is there,
    // ";" when ";" is), nor the same symbol as a context key and a filler.
    const seen = new Set(syms.slice(0, SYM_SLOTS[this.profile]).map((t) => parseToken(t).insert));
    next = next.filter((id) => {
      const e = keyEssence(id);
      if (e == null) return true;
      if (seen.has(e)) return false;
      seen.add(e);
      return true;
    });
    const slots = stableSlots(this.ctx, next, this.ctxEls.length);
    this.ctx = slots;
    slots.forEach((id, i) => {
      const el = this.ctxEls[i];
      if (el._id === id) return; // unchanged: no DOM work on every keystroke
      el._id = id;
      this.setKey(el, id ? this.ctxSpec(id) : { label: '', title: '', tap: () => {}, cls: 'empty' });
    });
  }

  // ---- key specs ---------------------------------------------------------------

  describe(name) {
    const d = this.deps.describe ? this.deps.describe(name) : null;
    const [label, text] = ACTION_KEYS[name] || [name, name];
    return { label, title: d && d.key ? `${text} (${d.key})` : text };
  }

  actionSpec(name, over = {}) {
    const d = this.describe(name);
    const repeat = ['backspace', 'deleteForward', 'undo', 'redo', 'pageUp', 'pageDown'].includes(name);
    return { label: d.label, title: d.title, cls: 'action', repeat, tap: () => this.runAction(name), ...over };
  }

  runAction(name) {
    if (name === 'paste' || name === 'cut' || name === 'copy') { this.deps.run(name); return; }
    const mods = this.consumeMods();
    if (name === 'tab' && mods.shift) { this.deps.run('outdent'); return; }
    this.deps.run(name);
  }

  // The small symbol in a key's top corner is what a swipe up (or a hold) does.

  tabSpec() {
    const outdent = () => this.deps.run('outdent');
    return { ...this.actionSpec('tab'), title: 'Tab / indent / accept suggestion · swipe up or hold: Shift+Tab (outdent)', up: outdent, hold: outdent, corner: ['⇤'] };
  }

  undoSpec() {
    const redo = () => this.deps.run('redo');
    return { ...this.actionSpec('undo'), label: '', icon: 'undo', sub: 'undo', title: 'Undo (Ctrl+Z) · swipe up or hold: Redo (Ctrl+Y)', repeat: false, up: redo, hold: redo, holdRepeat: true, corner: ['↷'] };
  }

  /** Home / End: with Shift armed they select. */
  navSpec(dir) {
    const name = dir === 'home' ? 'lineStart' : 'lineEnd';
    return { ...this.actionSpec(name), tap: () => this.deps.arrow(dir, this.consumeMods()) };
  }

  lineSpec() {
    const fan = ['completeStatement', 'newlineAbove', 'duplicateLine', 'joinLines', 'deleteLine', 'toggleComment'];
    return {
      ...this.actionSpec('newlineBelow'), cls: 'action line', sub: 'line',
      title: 'New line below (Ctrl+Enter) · swipe up / down: move the line · hold: more line actions',
      up: () => this.deps.run('lineUp'), down: () => this.deps.run('lineDown'), swipeRepeat: true, corner: ['⇡', '⇣'],
      fan: fan.map((n) => ({ ...this.describe(n), run: () => this.deps.run(n) })),
    };
  }

  cursorsSpec() {
    const fan = ['cursorsOnLines', 'selectNext', 'selectAllMatches'];
    return {
      label: '', icon: 'cursors', sub: 'cursor', cls: 'action cursors',
      title: 'Multi-cursor: add a cursor below (Ctrl+Alt+↓) · swipe up: above · hold: a cursor on each selected line, next match, all matches',
      tap: () => this.deps.run('addCursorDown'), up: () => this.deps.run('addCursorUp'), down: () => this.deps.run('addCursorDown'),
      swipeRepeat: true, corner: ['⇡'],
      fan: fan.map((n) => ({ ...this.describe(n), run: () => this.deps.run(n) })),
    };
  }

  moreSpec() {
    return { label: '⋯', sub: 'all keys', cls: 'action more', title: 'All keys', tap: () => { this.sheetOpen = !this.sheetOpen; this.render(); } };
  }

  modSpec(active) {
    const armed = ['ctrl', 'shift', 'alt'].filter((m) => this.mods[m]);
    const label = active ? 'Mod' : armed.length ? armed.map((m) => ({ ctrl: 'Ctrl', shift: '⇧', alt: 'Alt' }[m])).join('') : 'Mod';
    return {
      label, sub: 'Ctrl ⇧ Alt', cls: `action mod-key${active ? ' armed' : ''}${armed.length && !active ? ' has-mods' : ''}`,
      title: 'Modifiers: Ctrl, Shift, Alt, Esc, Home, End',
      tap: () => { this.layer = this.layer === 'main' ? 'mod' : 'main'; this.render(); },
    };
  }

  modifierSpec(name, { active = false } = {}) {
    const label = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' }[name];
    let lastTap = 0;
    return {
      label, cls: 'action mod', mod: name,
      title: `${label} (tap: next key only · double-tap: lock)`,
      tap: () => {
        const now = Date.now();
        const cur = this.mods[name];
        if (active && cur) this.mods[name] = 0;
        else if (cur === 1 && now - lastTap < 350) this.mods[name] = 2;
        else this.mods[name] = cur ? 0 : 1;
        lastTap = now;
        if (this.profile !== 'tablet') this.layer = name === 'ctrl' && this.mods.ctrl ? 'ctrl' : 'main';
        this.render();
      },
    };
  }

  ctrlKeys() {
    return CTRL_KEYS.map(([k, name]) => ({
      label: k, sub: this.describe(name).title.replace(/ \(.*\)$/, ''), cls: 'action ctrl-key', title: `Ctrl+${k}: ${this.describe(name).title}`,
      tap: () => {
        this.deps.run(name);
        if (this.mods.ctrl === 1) { this.mods.ctrl = 0; this.layer = 'main'; this.render(); }
      },
    }));
  }

  /** A symbol from the language's layout: tap, swipe up / down / left / right, hold for all variants. */
  symbolSpec(token) {
    const k = parseToken(token);
    const alts = k.alts;
    const swipes = Object.keys(SWIPES).slice(0, alts.length).map((dir, i) => `${dir}: ${alts[i]}`).join(' · ');
    return {
      label: k.label, cls: alts.length > 2 ? 'sym four-way' : 'sym', corner: alts.slice(0, 4),
      title: alts.length ? `${k.label} — swipe ${swipes} · hold: ${alts.length > 1 ? 'all' : alts[0]}` : k.label,
      tap: () => this.typeSymbol(this.mods.shift && alts[0] ? alts[0] : k.insert),
      up: alts[0] ? () => this.typeSymbol(alts[0]) : null,
      down: alts[1] ? () => this.typeSymbol(alts[1]) : null,
      left: alts[2] ? () => this.typeSymbol(alts[2]) : null,
      right: alts[3] ? () => this.typeSymbol(alts[3]) : null,
      alt: alts.length === 1 ? alts[0] : null,
      fan: alts.length > 1 ? [k.insert, ...alts].map((t, i) => ({ label: t, title: t, run: () => this.typeSymbol(t), preset: i === 1 })) : null,
    };
  }

  /** A context slot's key: "@action", "t:text key" or "s:symbol token". */
  ctxSpec(id) {
    if (id.startsWith('@')) return this.actionSpec(id.slice(1));
    if (id.startsWith('s:')) return this.symbolSpec(id.slice(2));
    const token = id.slice(2);
    return { label: keyLabel(token), title: `Type ${keyLabel(token)}`, cls: 'sym ctx-text', tap: () => this.insertTextKey(token) };
  }

  // ---- typing -----------------------------------------------------------------

  typeSymbol(text) {
    const mods = this.consumeMods();
    if (mods.ctrl && text === '/') { this.deps.run('toggleComment'); return; }
    if (mods.ctrl && text === '[') { this.deps.run('outdent'); return; }
    if (mods.ctrl && text === ']') { this.deps.run('indent'); return; }
    this.deps.type(text);
  }

  /** A context key like `class="|"`: types it, with the cursor where "|" was. */
  insertTextKey(token) {
    this.consumeMods();
    const view = this.deps.getView();
    if (!view || view.state.readOnly) return;
    const { text, cursor } = parseTextKey(token);
    // Brackets and quotes go through the normal typing path (auto-close,
    // wrapping a selection); the closer is added if auto-close is off.
    if (text.length === 2 && cursor === 1 && PAIRS[text[0]] === text[1]) {
      this.deps.type(text[0]);
      const st = view.state;
      const head = st.selection.main.head;
      if (st.selection.main.empty && st.sliceDoc(head, head + 1) !== text[1]) view.dispatch({ changes: { from: head, insert: text[1] } });
      return;
    }
    if (cursor === text.length) { this.deps.type(text); return; }
    const { state } = view;
    view.dispatch(state.changeByRange((r) => ({
      changes: { from: r.from, to: r.to, insert: text },
      range: EditorSelection.cursor(r.from + cursor),
    })), { scrollIntoView: true, userEvent: 'input.type' });
  }

  // ---- modifiers --------------------------------------------------------------

  renderMods() {
    for (const btn of this.el.querySelectorAll('[data-mod]')) {
      const v = this.mods[btn.dataset.mod];
      btn.classList.toggle('armed', v > 0);
      btn.classList.toggle('locked', v === 2);
      btn.setAttribute('aria-pressed', v > 0 ? 'true' : 'false');
    }
  }

  /** Returns the active modifiers and releases the one-shot ones. */
  consumeMods() {
    const out = { shift: this.mods.shift > 0, ctrl: this.mods.ctrl > 0, alt: this.mods.alt > 0 };
    let changed = false;
    for (const k of Object.keys(this.mods)) if (this.mods[k] === 1) { this.mods[k] = 0; changed = true; }
    if (changed) {
      if (this.layer === 'ctrl' && !this.mods.ctrl) this.layer = 'main';
      this.render();
    }
    return out;
  }

  // ---- the "More" sheet ---------------------------------------------------------

  sheet() {
    const K = (spec) => this.key(spec);
    const close = () => { this.sheetOpen = false; this.render(); };
    // (no swipes in the sheet: a vertical drag scrolls it)
    const wrap = (spec) => ({ ...spec, up: null, down: null, left: null, right: null, repeat: false, tap: () => { close(); spec.tap(); } });
    const groups = [[`Symbols (${this.group})`, this.symbols()], ...MORE_GROUPS];
    return h('div.keys-sheet', { role: 'dialog', 'aria-label': 'All keys' },
      h('div.keys-sheet-head', h('span', 'All keys'), K({ label: '✕', cls: 'action', title: 'Close', tap: close })),
      ...groups.map(([name, keys]) => h('div.keys-sheet-group',
        h('div.keys-sheet-title', name),
        h('div.keys-sheet-keys', ...keys.map((k) => K(wrap(k.startsWith('@') ? this.actionSpec(k.slice(1)) : this.symbolSpec(k))))))));
  }

  // ---- keys and their touch handling ------------------------------------------------

  key(spec, base = '') {
    const btn = h('button.key', { type: 'button' });
    btn._base = base;
    this.setKey(btn, spec);
    this.bindKey(btn);
    return btn;
  }

  setKey(btn, spec) {
    btn._spec = spec;
    btn.className = ['key', btn._base, spec.cls || 'action'].filter(Boolean).join(' ');
    btn.title = spec.title || spec.label;
    btn.setAttribute('aria-label', spec.title || spec.label);
    if (spec.mod) btn.dataset.mod = spec.mod; else delete btn.dataset.mod;
    btn.textContent = '';
    btn.append(spec.icon ? h('span.key-label.key-icon', { html: icon(spec.icon, 20) }) : h('span.key-label', spec.label));
    if (spec.sub) btn.append(h('span.key-sub', spec.sub));
    const [c1, c2, c3, c4] = spec.corner || [];
    if (c1) btn.append(h('span.alt', c1));
    if (c2) btn.append(h('span.alt.alt-down', c2));
    if (c3) btn.append(h('span.alt.alt-left', c3));
    if (c4) btn.append(h('span.alt.alt-right', c4));
    btn.disabled = spec.cls === 'empty';
  }

  feedback(btn, strong = false) {
    haptic(this.deps.getSettings(), strong ? 20 : 6);
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 120);
  }

  bindKey(btn) {
    let P = null; // the press in progress
    const clear = () => {
      if (!P) return;
      clearTimeout(P.hold); clearInterval(P.repeat); clearTimeout(P.repeat);
      if (P.chooser) P.chooser.close();
      btn.classList.remove('swiped', 'holding');
      this.hidePreview();
      this.presses.delete(clear);
      P = null;
      this.pressing = Math.max(0, this.pressing - 1);
      if (!this.pressing && this.ctxPending) { this.ctxPending = false; this.updateContext(); }
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (P) clear();
      const spec = btn._spec;
      if (!spec || btn.disabled) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      this.pressing++;
      this.presses.add(clear);
      P = { spec, x0: e.clientX, y0: e.clientY, mode: 'none', held: false, past: false, fired: false };
      if (spec.fan || spec.hold || spec.alt || spec.repeat) P.hold = setTimeout(() => this.onHold(btn, P), LONG_PRESS);
    });
    btn.addEventListener('pointermove', (e) => {
      if (!P) return;
      if (P.chooser) { P.chooser.track(e.clientX, e.clientY); return; }
      const dx = e.clientX - P.x0, dyUp = P.y0 - e.clientY;
      // A four-way key keeps reading the direction until the swipe is long
      // enough: the whole stroke counts, not its first wobbly pixels.
      const sideways = !!(P.spec.left || P.spec.right);
      if (P.mode === 'none' || (sideways && !P.past && P.mode !== 'pan')) {
        const m = classifyKeyDrag(dx, dyUp, sideways);
        if (SWIPES[m] != null && P.spec[m]) { P.mode = m; clearTimeout(P.hold); }
        // any other drag: not a tap (in the sheet or the Ctrl row it scrolls)
        else if (m !== 'none' && !P.held) { P.mode = 'pan'; clearTimeout(P.hold); }
      }
      if (SWIPES[P.mode] != null) {
        const past = { up: dyUp, down: -dyUp, left: -dx, right: dx }[P.mode] > SWIPE_PX;
        if (past !== P.past) {
          P.past = past;
          btn.classList.toggle('swiped', past);
          const alt = P.spec.cls && P.spec.cls.includes('sym') ? P.spec.corner[SWIPES[P.mode]] : null;
          if (past && alt) this.showPreview(btn, alt); else this.hidePreview();
          if (past) haptic(this.deps.getSettings(), 8);
        }
        // Line / cursor keys act right away and repeat while the finger stays.
        if (past && P.spec.swipeRepeat && !P.fired) {
          P.fired = true;
          const act = P.spec[P.mode];
          act();
          P.repeat = setTimeout(function again() { act(); P.repeat = setTimeout(again, SWIPE_REPEAT); }, SWIPE_REPEAT * 1.6);
        }
      }
    });
    // The bar must not scroll or zoom under a finger that is swiping on a key.
    btn.addEventListener('touchmove', (e) => { if (P && (SWIPES[P.mode] != null || P.held) && e.cancelable) e.preventDefault(); }, { passive: false });
    btn.addEventListener('pointercancel', () => clear());
    btn.addEventListener('pointerup', () => {
      if (!P) return;
      const p = P;
      const choice = p.chooser ? p.chooser.picked() : null;
      clear();
      if (p.chooser) { if (choice) { choice.run(); this.feedback(btn); } return; }
      if (p.mode === 'pan' || p.repeating || p.fired) return;
      if (SWIPES[p.mode] != null) { if (p.past) { p.spec[p.mode](); this.feedback(btn); } return; }
      if (p.held) { if (p.spec.alt && !p.spec.hold) { this.typeSymbol(p.spec.alt); this.feedback(btn); } return; }
      p.spec.tap();
      this.feedback(btn);
    });
    // No "ghost click" after a tap: the key may have changed the layout (the
    // sheet closed, a layer switched), and the browser's click would land on
    // whatever is under the finger now. The key acted on pointerup already.
    btn.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); });
    // Keyboard / screen-reader activation fires `click` without pointer events.
    btn.addEventListener('click', () => { if (Date.now() - this.pointerAt > 800 && btn._spec) btn._spec.tap(); });
  }

  onHold(btn, P) {
    if (!P || P.mode !== 'none') return;
    P.held = true;
    const spec = P.spec;
    if (spec.fan) {
      // Felt and seen: strong vibration, the key lights up, the choices pop up.
      btn.classList.add('holding');
      haptic(this.deps.getSettings(), 20);
      P.chooser = new Chooser(btn, spec.fan, () => haptic(this.deps.getSettings(), 5), P.x0, P.y0);
    } else if (spec.hold) {
      btn.classList.add('holding');
      spec.hold();
      haptic(this.deps.getSettings(), 20);
      if (spec.holdRepeat) P.repeat = setInterval(() => spec.hold(), 300);
    } else if (spec.alt) {
      btn.classList.add('swiped');
      this.showPreview(btn, spec.alt);
      haptic(this.deps.getSettings(), 20);
    } else if (spec.repeat) {
      P.repeating = true;
      spec.tap();
      this.feedback(btn);
      P.repeat = setInterval(() => spec.tap(), REPEAT_EVERY);
    }
  }

  /** The bubble above a key showing the symbol a hold / swipe will type. */
  showPreview(btn, text) {
    this.hidePreview();
    const r = btn.getBoundingClientRect();
    const el = h('div.key-preview', { role: 'status', 'aria-live': 'polite' }, h('span.key-preview-char', text), h('span.key-preview-hint', 'release'));
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${r.top - 6}px`;
    document.body.append(el); // outside the zoomed bar, so fixed coordinates stay exact
    this.preview = el;
  }

  hidePreview() {
    if (this.preview) { this.preview.remove(); this.preview = null; }
  }

  // ---- joystick ------------------------------------------------------------------

  /**
   * The cursor follows the finger, with mouse-like acceleration: moved
   * slowly, about 18 px a character (precise); moved fast, about 5 px (far).
   * The drag sticks to one direction (left/right or up/down) so a slightly
   * diagonal finger doesn't jump lines; it changes direction only after a
   * clear turn. The end (and start) of a line stops it: keep pushing a moment
   * to go on to the next line. Resting the finger far out (> JOY_FAST px)
   * keeps the cursor moving. Tap: select the word. Hold, then drag: select.
   * Quick flick left / right: line start / end. Shift selects, Alt moves
   * lines (↑↓) or jumps by word part (←→).
   */
  joystick() {
    const btn = h('button.key.joystick', { type: 'button', title: 'Joystick: drag to move the cursor (slowly = precisely; it stops at the line end, keep pushing to go on) · tap: select word · hold then drag: select · flick ←/→: line start/end', 'aria-label': 'Cursor joystick' },
      h('span.joy-arrows', { html: icon('joystick', 30) }), h('span.knob'));
    const knob = btn.lastChild;
    let P = null;
    const step = (dir, now) => {
      const shift = P.select || P.mods.shift;
      // The line's end (and start) is a wall: an overshoot stops there. Only
      // pushing on, for JOY_WALL ms and a couple more characters' worth,
      // goes through to the next line.
      const view = this.deps.getView();
      if (atLineEdge(view, dir, shift)) {
        const head = view.state.selection.main.head;
        const w = P.wall;
        if (!w || w.dir !== dir || w.head !== head) {
          P.wall = { dir, head, since: now, pushes: 0 };
          btn.classList.add('at-edge');
          haptic(this.deps.getSettings(), 15);
          return;
        }
        if (++w.pushes < 2 || now - w.since < JOY_WALL) return;
      }
      if (P.wall) { P.wall = null; btn.classList.remove('at-edge'); }
      this.deps.arrow(dir, { shift, ctrl: P.mods.ctrl, alt: P.mods.alt });
      const t = Date.now();
      if (t - P.tick > 25) { haptic(this.deps.getSettings(), 3); P.tick = t; } // a tick per character
    };
    // Resting far out along the locked direction: the cursor keeps going
    // (3…25 a second), after a short pause so it never overshoots by surprise.
    const loop = (t) => {
      if (!P) return;
      const dt = Math.min(0.1, (t - (P.lastT || t)) / 1000);
      P.lastT = t;
      const d = P.axis === 'x' ? P.x - P.x0 : P.axis === 'y' ? P.y - P.y0 : 0;
      const out = Math.abs(d) - JOY_FAST;
      if (out <= 0) { P.outSince = 0; P.auto = 0; }
      else {
        if (!P.outSince) P.outSince = t;
        if (t - P.outSince > JOY_DWELL) {
          P.auto += dt * Math.min(25, 3 + out / 4);
          while (P.auto >= 1) { P.auto -= 1; step(P.axis === 'x' ? (d < 0 ? 'left' : 'right') : (d < 0 ? 'up' : 'down'), t); }
        }
      }
      P.raf = requestAnimationFrame(loop);
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      P = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, lt: e.timeStamp,
        axis: null, acc: 0, auto: 0, outSince: 0, t0: Date.now(), tick: 0, moved: false, select: false,
        mods: { ...this.consumeModsQuiet() } };
      this.presses.add(stopJoy);
      btn.classList.add('active');
      P.hold = setTimeout(() => {
        if (P && !P.moved) { P.select = true; btn.classList.add('selecting'); haptic(this.deps.getSettings(), 20); }
      }, 420);
      P.raf = requestAnimationFrame(loop);
    });
    btn.addEventListener('pointermove', (e) => {
      if (!P) return;
      const ddx = e.clientX - P.lx, ddy = e.clientY - P.ly;
      const dt = Math.max(1, e.timeStamp - P.lt);
      P.lx = e.clientX; P.ly = e.clientY; P.lt = e.timeStamp;
      P.x = e.clientX; P.y = e.clientY;
      const kx = Math.max(-14, Math.min(14, P.x - P.x0)), ky = Math.max(-10, Math.min(10, P.y - P.y0));
      knob.style.transform = `translate(${kx}px, ${ky}px)`;
      const fromStart = Math.hypot(P.x - P.x0, P.y - P.y0);
      if (!P.moved) { if (fromStart < 8) return; P.moved = true; clearTimeout(P.hold); }
      // One direction at a time.
      if (!P.axis) {
        if (fromStart < JOY_LOCK) return;
        P.axis = Math.abs(P.x - P.x0) >= Math.abs(P.y - P.y0) ? 'x' : 'y';
        P.ox = P.x; P.oy = P.y;
      } else if (P.axis === 'x' ? Math.abs(P.y - P.oy) > JOY_TURN : Math.abs(P.x - P.ox) > JOY_TURN) {
        P.axis = P.axis === 'x' ? 'y' : 'x';
        P.ox = P.x; P.oy = P.y; P.x0 = P.x; P.y0 = P.y; P.acc = 0;
      }
      if (P.axis === 'x') P.oy += (P.y - P.oy) * 0.05; else P.ox += (P.x - P.ox) * 0.05; // slow drift is forgiven
      const d = P.axis === 'x' ? ddx : ddy;
      const gain = 0.6 + Math.min(1.6, (Math.abs(d) / dt) * 1.6); // px/ms → slow: 0.6, fast: up to 2.2
      P.acc += d * gain;
      const size = P.axis === 'x' ? JOY_STEP_X : JOY_STEP_Y;
      while (Math.abs(P.acc) >= size) {
        step(P.axis === 'x' ? (P.acc > 0 ? 'right' : 'left') : (P.acc > 0 ? 'down' : 'up'), e.timeStamp);
        P.acc -= Math.sign(P.acc) * size;
      }
    });
    btn.addEventListener('touchmove', (e) => { if (P && e.cancelable) e.preventDefault(); }, { passive: false });
    btn.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); });
    const stopJoy = () => end(true);
    const end = (cancelled) => {
      if (!P) return;
      const p = P;
      P = null;
      this.presses.delete(stopJoy);
      clearTimeout(p.hold);
      cancelAnimationFrame(p.raf);
      btn.classList.remove('active', 'selecting', 'at-edge');
      knob.style.transform = '';
      if (this.modsChangedQuietly) {
        this.modsChangedQuietly = false;
        if (this.layer === 'ctrl' && !this.mods.ctrl) this.layer = 'main';
        setTimeout(() => this.render(), 0);
      }
      if (cancelled) return;
      const dt = Date.now() - p.t0, dx = p.x - p.x0, dy = p.y - p.y0;
      if (!p.moved && !p.select && dt < 350) { this.deps.run('selectWord'); this.feedback(btn); return; }
      if (dt < 250 && p.axis === 'x' && Math.abs(dx) >= JOY_FLICK && Math.abs(dy) < Math.abs(dx) * 0.6) {
        this.deps.arrow(dx > 0 ? 'end' : 'home', { shift: p.select || p.mods.shift });
        this.feedback(btn);
      }
    };
    btn.addEventListener('pointerup', () => end(false));
    btn.addEventListener('pointercancel', () => end(true));
    return btn;
  }

  /** consumeMods() without re-rendering mid-press (the joystick is under the finger). */
  consumeModsQuiet() {
    const out = { shift: this.mods.shift > 0, ctrl: this.mods.ctrl > 0, alt: this.mods.alt > 0 };
    let changed = false;
    for (const k of Object.keys(this.mods)) if (this.mods[k] === 1) { this.mods[k] = 0; changed = true; }
    if (changed) { this.renderMods(); this.modsChangedQuietly = true; }
    return out;
  }
}

/**
 * The choices that pop up above a held key (symbol variants, the line fan):
 * slide to one and release. Sliding back down below the key cancels.
 */
class Chooser {
  constructor(btn, items, onChange, x0, y0) {
    this.x0 = x0;
    this.y0 = y0;
    this.btn = btn;
    this.items = items;
    this.onChange = onChange;
    this.el = h('div.key-chooser', { role: 'listbox' },
      ...items.map((it) => h('div.key-choice', { role: 'option', title: it.title || it.label }, it.label)));
    document.body.append(this.el); // outside the zoomed bar: fixed coordinates stay exact
    const r = btn.getBoundingClientRect();
    const w = this.el.offsetWidth, hgt = this.el.offsetHeight;
    const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${Math.max(6, r.top - hgt - 10)}px`;
    this.keyRect = r;
    this.index = items.findIndex((it) => it.preset);
    this.paint();
  }

  track(x, y) {
    // Nothing is chosen until the finger actually moves (a still release
    // keeps the preset, or cancels).
    if (!this.armed) { if (Math.hypot(x - this.x0, y - this.y0) < 12) return; this.armed = true; }
    let i = -1;
    if (y < this.keyRect.bottom + 30) {
      // The choices may wrap onto two rows (the operator key has a dozen):
      // the one under the finger, else the nearest.
      const rects = [...this.el.children].map((e) => e.getBoundingClientRect());
      i = rects.findIndex((r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 6 && y <= r.bottom + 6);
      if (i < 0) {
        let best = Infinity;
        rects.forEach((r, k) => {
          const d = Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2);
          if (d < best) { best = d; i = k; }
        });
      }
    }
    if (i !== this.index) { this.index = i; this.paint(); if (i >= 0) this.onChange(); }
  }

  paint() {
    [...this.el.children].forEach((e, i) => e.classList.toggle('on', i === this.index));
  }

  picked() { return this.index >= 0 ? this.items[this.index] : null; }

  close() { this.el.remove(); }
}

export { parseLayout };

/** What a context-slot key types, to spot duplicates: "(" for "()", "=" for " = ". */
function keyEssence(id) {
  if (id.startsWith('@')) return null;
  if (id.startsWith('s:')) return parseToken(id.slice(2)).insert;
  const { text, cursor } = parseTextKey(id.slice(2));
  if (text.length === 2 && cursor === 1 && PAIRS[text[0]] === text[1]) return text[0];
  return text.trim() || text;
}
