// keysBar.js
//
// TWO DESIGN DECISIONS HERE THAT CHANGED FROM THE ORIGINAL PLAN — both
// worth understanding, because the reasons are real constraints of mobile
// web input, not arbitrary choices:
//
// 1) NO "TAP CTRL, THEN TYPE A LETTER" SIMULATION.
//    Mobile soft keyboards (Gboard, Samsung Keyboard, iOS) go through an
//    IME (Input Method Editor) composition step for most input. During
//    composition, the browser frequently reports keydown events with
//    `key: "Unidentified"` or `keyCode 229` instead of the actual
//    character — this is a well-known, long-standing limitation, not a
//    bug we can code around. So "arm a virtual Ctrl, then read the next
//    real keypress from the OS keyboard" is fundamentally unreliable on
//    Android. Instead, the handful of Ctrl-combos you'd actually reach for
//    (Undo, Redo, Save, Select All) are their own direct buttons. Less
//    "authentic modifier key," but it actually works every time.
//
// 2) NO DIRECT "IS A HARDWARE KEYBOARD CONNECTED" CHECK.
//    There's no cross-browser API that exposes this. The reliable-enough
//    proxy: when the on-screen keyboard opens, the visual viewport
//    shrinks (the OS shrinks the visible page area to make room for it).
//    So: focus the editor, wait for the show/hide animation to settle,
//    then measure. If the viewport shrank, a soft keyboard is up — show
//    the bar. If it didn't shrink, either a hardware keyboard suppressed
//    the OS keyboard, or none was needed — either way, no bar required.
//    A manual override (Settings > Coding keys bar: Auto/Always/Never)
//    exists as an escape hatch for the cases this heuristic gets wrong.

const SYMBOLS = ['{', '}', '[', ']', '(', ')', '<', '>', ';', ':', "'", '"', '`', '/', '\\', '|', '&', '_', '-', '=', '+', '*', '#', '$', '%', '^', '@', '!', '?'];

const VIEWPORT_SETTLE_MS = 350;
const SHRINK_THRESHOLD_PX = 120;

export class KeysBar {
  constructor(barEl, editorManager, { onSave } = {}) {
    this.barEl = barEl;
    this.editorManager = editorManager;
    this.onSave = onSave || (() => {});
    this.mode = 'auto'; // 'auto' | 'always' | 'never'
    this.isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

    this._buildDom();
    if (this.isTouchDevice) this._wireVisibility();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'never') this._hide();
    else if (mode === 'always') this._show();
    // 'auto' takes effect next focus/blur cycle
  }

  _buildDom() {
    this.barEl.innerHTML = '';

    const actionRow = document.createElement('div');
    actionRow.className = 'keys-row keys-row-actions';
    const actions = [
      ['Tab', () => this.editorManager.indent()],
      ['Esc', () => this.editorManager.view.contentDOM.blur()],
      ['\u2190', () => this.editorManager.moveCursor('left')],
      ['\u2192', () => this.editorManager.moveCursor('right')],
      ['\u2191', () => this.editorManager.moveCursor('up')],
      ['\u2193', () => this.editorManager.moveCursor('down')],
      ['Undo', () => this.editorManager.undo()],
      ['Redo', () => this.editorManager.redo()],
      ['Save', () => this.onSave()],
      ['Sel. All', () => this.editorManager.selectAll()],
    ];
    for (const [label, fn] of actions) {
      actionRow.appendChild(this._makeKeyBtn(label, fn, 'key-btn-action'));
    }

    const symbolRow = document.createElement('div');
    symbolRow.className = 'keys-row keys-row-symbols';
    for (const sym of SYMBOLS) {
      symbolRow.appendChild(this._makeKeyBtn(sym, () => this.editorManager.insertText(sym), 'key-btn-symbol'));
    }

    this.barEl.appendChild(actionRow);
    this.barEl.appendChild(symbolRow);
  }

  _makeKeyBtn(label, fn, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `key-btn ${extraClass}`;
    btn.textContent = label;
    // pointerdown (not click) + preventDefault: stops the button press
    // from stealing focus away from the editor, which would dismiss the
    // on-screen keyboard and this bar along with it.
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
    });
    return btn;
  }

  _wireVisibility() {
    const contentEl = this.editorManager.view.contentDOM;
    contentEl.addEventListener('focus', () => this._onFocus());
    contentEl.addEventListener('blur', () => {
      if (this.mode === 'auto') this._hide();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this._reposition());
      window.visualViewport.addEventListener('scroll', () => this._reposition());
    }
  }

  _onFocus() {
    if (this.mode === 'never') return;
    if (this.mode === 'always') { this._show(); return; }

    const before = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    setTimeout(() => {
      const after = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      if (before - after > SHRINK_THRESHOLD_PX) this._show();
      else this._hide();
    }, VIEWPORT_SETTLE_MS);
  }

  _show() {
    this.barEl.classList.remove('hidden');
    this._reposition();
  }

  _hide() {
    this.barEl.classList.add('hidden');
  }

  _reposition() {
    if (!window.visualViewport || this.barEl.classList.contains('hidden')) return;
    const vv = window.visualViewport;
    const offsetFromBottom = window.innerHeight - (vv.height + vv.offsetTop);
    this.barEl.style.bottom = Math.max(0, offsetFromBottom) + 'px';
  }
}
