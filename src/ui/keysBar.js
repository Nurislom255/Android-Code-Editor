// ui/keysBar.js — the coding-keys row above the soft keyboard (spec §3.1).
//
//   Row 1 (actions): Tab, Complete statement, new line / move line, a
//          trackpad strip (drag to move the cursor — works with ANY keyboard
//          app, unlike Gboard's space-bar trick), undo/redo, hide keyboard,
//          Shift/Ctrl/Alt, multi-cursor keys, more line operations.
//   Row 2 (symbols): per language (JS, HTML, CSS, Python, C-like…), editable
//          in Settings. Tap = the symbol; SWIPE UP on a key = its alternate
//          (the small character in the corner), like Gboard's long-press row.
//
// Every key reacts on pointer *up* (not down), because the rows scroll
// sideways: a finger that lands on a key and then pans the row must not type.
// `preventDefault()` on pointerdown keeps focus in the editor so the soft
// keyboard stays open.
//
// Modifiers are one-shot (tap: next key only), double-tap locks them — the
// usual behaviour of on-screen keyboards. They only combine with keys on this
// bar: a soft keyboard's own letters arrive through the IME, where a
// "virtual Ctrl" can't be applied reliably (v1 README explains why).

import { h, icon, haptic, isTouchDevice } from './dom.js';
import { parseLayout, groupForLanguage, DEFAULT_LAYOUTS } from '../core/keysLayout.js';

const SWIPE_UP_PX = 18;
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 55;
const TRACK_X = 11; // px of drag per character
const TRACK_Y = 20; // px of drag per line

export class KeysBar {
  /**
   * @param {HTMLElement} el
   * @param {{getView:()=>any, getSettings:()=>object, run:(name:string)=>void, arrow:(dir:string, mods:object)=>void,
   *          type:(text:string)=>void, onLayoutChange?:()=>void}} deps
   */
  constructor(el, deps) {
    this.el = el;
    this.deps = deps;
    this.group = 'plain';
    this.mods = { shift: 0, ctrl: 0, alt: 0 }; // 0 off, 1 one-shot, 2 locked
    this.keyboardOpen = false;
    this.editorFocused = false;
    this.build();
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
      const h = Math.min(window.innerHeight, vv ? vv.height * vv.scale : Infinity);
      const base = Math.max(this.baseline.get(w) || 0, h);
      this.baseline.set(w, base);
      // A keyboard takes well over 120 px; browser bars appearing don't.
      this.keyboardOpen = isTouchDevice() && base - h > Math.max(120, base * 0.18);
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

  update() {
    const s = this.deps.getSettings();
    const hasEditor = !!this.deps.getView();
    let show;
    if (s.keysBarMode === 'never' || !hasEditor) show = false;
    else if (s.keysBarMode === 'always') show = true;
    else show = isTouchDevice() && this.editorFocused && this.keyboardOpen;
    if (this.el.classList.contains('hidden') === !show) return;
    this.el.classList.toggle('hidden', !show);
    // The bar is part of the flex layout: the editor shrinks to make room,
    // so nothing ends up hidden behind it.
    requestAnimationFrame(() => this.deps.onLayoutChange && this.deps.onLayoutChange());
  }

  setLanguage(langId) {
    const g = groupForLanguage(langId);
    if (g === this.group) return;
    this.group = g;
    this.buildSymbols();
  }

  // ---- building ------------------------------------------------------------

  build() {
    this.el.textContent = '';
    this.actionsRow = h('div.keys-row.keys-actions', { role: 'toolbar', 'aria-label': 'Editing keys' });
    this.symbolsRow = h('div.keys-row.keys-symbols', { role: 'toolbar', 'aria-label': 'Symbols' });
    this.el.append(this.actionsRow, this.symbolsRow);

    const A = (label, title, fn, opts = {}) => this.actionKey(label, title, fn, opts);

    // Most-used first. The arrow keys are gone: the trackpad strip moves the
    // cursor (with ⇧ armed it selects), Home/End jump within the line.
    this.actionsRow.append(
      A('Tab', 'Tab / indent / accept suggestion / jump past ;', () => (this.mods.shift ? this.deps.run('outdent') : this.deps.run('tab')), { consume: true }),
      A('⏎;', 'Complete statement: add ; (or : / { }) and start a new line', () => this.deps.run('completeStatement')),
      A('↵Ln', 'New line below', () => this.deps.run('newlineBelow')),
      A('⇡Ln', 'Move line up', () => this.deps.run('lineUp'), { repeat: true }),
      A('⇣Ln', 'Move line down', () => this.deps.run('lineDown'), { repeat: true }),
      this.trackpadKey(),
      A('', 'Undo', () => this.deps.run('undo'), { iconName: 'undo' }),
      A('', 'Redo', () => this.deps.run('redo'), { iconName: 'redo' }),
      A('', 'Hide keyboard', () => this.deps.run('hideKeyboard'), { iconName: 'keyboardHide' }),
      this.modKey('shift', '⇧'),
      this.modKey('ctrl', 'Ctrl'),
      this.modKey('alt', 'Alt'),
      // multi-line editing: type on several lines at once
      A('+⇣', 'Add a cursor on the line below (type on several lines at once)', () => this.deps.run('addCursorDown'), { repeat: true }),
      A('+⇡', 'Add a cursor on the line above', () => this.deps.run('addCursorUp'), { repeat: true }),
      A('⫶', 'A cursor on each selected line (select lines by dragging the line numbers)', () => this.deps.run('cursorsOnLines')),
      A('Sel+', 'Select the word, then each next occurrence of it', () => this.deps.run('selectNext')),
      A('//', 'Toggle comment', () => this.deps.run('toggleComment')),
      A('⊕', 'Expand selection (word → expression → block)', () => this.deps.run('expandSelection')),
      A('⊖', 'Shrink selection', () => this.deps.run('shrinkSelection')),
      A('⇤', 'Outdent', () => this.deps.run('outdent')),
      A('Dup', 'Duplicate line', () => this.deps.run('duplicateLine')),
      A('Home', 'Line start', () => this.deps.arrow('home', this.consumeMods())),
      A('End', 'Line end', () => this.deps.arrow('end', this.consumeMods())),
      A('', 'Find / replace', () => this.deps.run('find'), { iconName: 'search' }),
      A('Sel', 'Select all', () => this.deps.run('selectAll')),
      A('', 'Save', () => this.deps.run('save'), { iconName: 'save' }),
      A('⌫', 'Backspace', () => this.deps.run('backspace'), { repeat: true }),
      A('✕Ln', 'Delete line', () => this.deps.run('deleteLine')),
    );
    this.buildSymbols();
  }

  buildSymbols() {
    const s = this.deps.getSettings();
    const layout = (s.keysLayouts && s.keysLayouts[this.group]) || DEFAULT_LAYOUTS[this.group] || DEFAULT_LAYOUTS.plain;
    this.symbolsRow.textContent = '';
    for (const k of parseLayout(layout)) this.symbolsRow.append(this.symbolKey(k));
  }

  /** Called when Settings change (layouts, haptics). */
  refresh() {
    this.buildSymbols();
    this.update();
  }

  // ---- key types --------------------------------------------------------------

  pressFeedback(btn) {
    haptic(this.deps.getSettings(), 6);
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 120);
  }

  /** Shared tap / hold-to-repeat behaviour; fires on release unless the row was panned. */
  bindPress(btn, fn, { repeat = false } = {}) {
    let start = null, timer = 0, repeating = false, cancelled = false;
    const stop = () => { clearTimeout(timer); clearInterval(timer); timer = 0; };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      cancelled = false;
      repeating = false;
      if (repeat) {
        timer = setTimeout(() => {
          repeating = true;
          fn(); this.pressFeedback(btn);
          timer = setInterval(() => fn(), REPEAT_EVERY);
        }, REPEAT_DELAY);
      }
    });
    btn.addEventListener('pointermove', (e) => {
      if (start && Math.abs(e.clientX - start.x) > 12 && !repeating) { cancelled = true; stop(); }
    });
    btn.addEventListener('pointercancel', () => { cancelled = true; stop(); start = null; btn._pointerAt = Date.now(); });
    btn.addEventListener('pointerleave', () => { if (repeating) { stop(); } });
    btn.addEventListener('pointerup', () => {
      stop();
      if (!start) return;
      start = null;
      btn._pointerAt = Date.now();
      if (cancelled || repeating) return;
      fn();
      this.pressFeedback(btn);
    });
    // Keyboard / screen-reader activation fires `click` without pointer
    // events. A tap fires BOTH, so skip clicks that follow a pointer press.
    btn.addEventListener('click', () => { if (Date.now() - (btn._pointerAt || 0) > 800) fn(); });
  }

  actionKey(label, title, fn, { repeat = false, iconName = null, consume = false } = {}) {
    const btn = h('button.key.action', { type: 'button', title, 'aria-label': title });
    if (iconName) btn.innerHTML = icon(iconName, 18);
    else btn.textContent = label;
    this.bindPress(btn, () => { fn(); if (consume) this.consumeMods(); }, { repeat });
    return btn;
  }

  symbolKey(k) {
    const btn = h('button.key.sym', { type: 'button', 'aria-label': k.alt ? `${k.label} (swipe up: ${k.alt})` : k.label, style: { touchAction: 'pan-x' } },
      k.label, k.alt ? h('span.alt', k.alt) : null);
    let start = null, cancelled = false, up = false;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      cancelled = false; up = false;
    });
    btn.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (Math.abs(e.clientX - start.x) > 14) cancelled = true;
      const isUp = k.alt && start.y - e.clientY > SWIPE_UP_PX;
      if (isUp !== up) { up = isUp; btn.classList.toggle('swiped', up); if (up) haptic(this.deps.getSettings(), 4); }
    });
    btn.addEventListener('pointercancel', () => { start = null; btn._pointerAt = Date.now(); btn.classList.remove('swiped'); });
    btn.addEventListener('pointerup', (e) => {
      if (!start) return;
      const swipedUp = k.alt && (up || start.y - e.clientY > SWIPE_UP_PX);
      start = null;
      btn._pointerAt = Date.now();
      btn.classList.remove('swiped');
      if (cancelled) return;
      this.insertSymbol(swipedUp ? k.alt : k.insert);
      this.pressFeedback(btn);
    });
    btn.addEventListener('click', () => { if (Date.now() - (btn._pointerAt || 0) > 800) this.insertSymbol(k.insert); });
    return btn;
  }

  insertSymbol(text) {
    const mods = this.consumeMods();
    if (mods.ctrl && text === '/') { this.deps.run('toggleComment'); return; }
    if (mods.ctrl && text === '[') { this.deps.run('outdent'); return; }
    if (mods.ctrl && text === ']') { this.deps.run('indent'); return; }
    this.deps.type(text);
  }

  modKey(name, label) {
    const btn = h('button.key.action.mod', { type: 'button', title: `${label} (tap: next key, double-tap: lock)`, 'aria-pressed': 'false' }, label);
    let lastTap = 0;
    this.bindPress(btn, () => {
      const now = Date.now();
      const cur = this.mods[name];
      if (cur === 1 && now - lastTap < 350) this.mods[name] = 2;
      else this.mods[name] = cur ? 0 : 1;
      lastTap = now;
      this.renderMods();
    });
    btn.dataset.mod = name;
    return btn;
  }

  renderMods() {
    for (const btn of this.actionsRow.querySelectorAll('.mod')) {
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
    if (changed) this.renderMods();
    return out;
  }

  trackpadKey() {
    const btn = h('button.key.trackpad', { type: 'button', title: 'Trackpad: drag to move the cursor (⇧ to select)', 'aria-label': 'Cursor trackpad' }, '◂ drag ▸');
    btn.style.touchAction = 'none';
    let last = null, accX = 0, accY = 0, mods = null;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
      accX = 0; accY = 0;
      mods = { shift: this.mods.shift > 0, ctrl: this.mods.ctrl > 0, alt: false };
      btn.classList.add('active');
    });
    btn.addEventListener('pointermove', (e) => {
      if (!last) return;
      accX += e.clientX - last.x;
      accY += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      let moved = false;
      while (Math.abs(accX) >= TRACK_X) {
        this.deps.arrow(accX > 0 ? 'right' : 'left', mods);
        accX -= Math.sign(accX) * TRACK_X;
        moved = true;
      }
      while (Math.abs(accY) >= TRACK_Y) {
        this.deps.arrow(accY > 0 ? 'down' : 'up', mods);
        accY -= Math.sign(accY) * TRACK_Y;
        moved = true;
      }
      if (moved) haptic(this.deps.getSettings(), 3);
    });
    const end = () => {
      if (!last) return;
      last = null;
      btn.classList.remove('active');
      this.consumeMods();
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    return btn;
  }
}
