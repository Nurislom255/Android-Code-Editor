// ui/shortcutsEditor.js — Settings → Keyboard shortcuts (ROADMAP 2.9), for a
// Bluetooth or USB keyboard: every command with its shortcut. Tap one, then
// press the new shortcut (or type it, e.g. "Ctrl+Shift+K"); take it off, or
// put the default back. A shortcut belongs to one command: giving it to
// another one moves it.

import { h } from './dom.js';
import { showModal, confirm } from './overlays.js';
import { comboFromEvent, parseCombo, comboProblem, effectiveKey, conflictsOf, normalizeBindings } from '../core/keybindings.js';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
// Browsers keep these for their own tabs and windows.
const BROWSER_KEYS = new Set(['Ctrl+W', 'Ctrl+T', 'Ctrl+N', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+Shift+W', 'Ctrl+Shift+Q']);
const words = (...parts) => parts.filter(Boolean).join(' ').toLowerCase();

export class ShortcutsEditor {
  /** @param {{get:()=>object, set:(patch:object)=>void, commands:()=>{id:string,label:string,key:string}[]}} o */
  constructor({ get, set, commands }) {
    this.get = get;
    this.set = set;
    this.commands = commands;
    this.list = h('div.sc-list', { role: 'list', 'aria-label': 'Commands and their shortcuts' });
    this.filter = h('input.input.sc-filter', { type: 'search', placeholder: 'Find a command or a key', 'aria-label': 'Find a command or a key', spellcheck: 'false', autocapitalize: 'off',
      oninput: () => this.render() });
    this.resetAll = h('button.btn.btn-small', { type: 'button', onclick: async () => {
      if (await confirm('Reset all shortcuts?', 'Every command gets its default shortcut back.', 'Reset')) { this.set({ keyBindings: {} }); this.render(); }
    } }, 'Reset all shortcuts');
    this.el = h('div.sc',
      h('p.s-desc', 'For a Bluetooth or USB keyboard. Tap a command to change its shortcut. Changed ones are marked •.'),
      this.filter, this.list, h('div.kbe-actions', this.resetAll));
    this.render();
  }

  defaults() { return Object.fromEntries(this.commands().map((c) => [c.id, c.key || ''])); }
  overrides() { return normalizeBindings(this.get().keyBindings, this.defaults()); }

  render() {
    const d = this.defaults(), o = this.overrides();
    const want = this.filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    this.list.textContent = '';
    this.resetAll.hidden = !Object.keys(o).length;
    const cmds = this.commands().slice().sort((a, b) => a.label.localeCompare(b.label));
    for (const c of cmds) {
      const key = effectiveKey(c.id, d, o);
      const search = words(c.label, key, c.id, 'shortcut keyboard key');
      if (!want.every((w) => search.includes(w))) continue;
      const changed = Object.prototype.hasOwnProperty.call(o, c.id);
      this.list.append(h('button.setting.sc-row', { type: 'button', role: 'listitem', dataset: { search }, 'aria-label': `${c.label}: ${key || 'no shortcut'}${changed ? ' (changed)' : ''}`, onclick: () => this.edit(c) },
        h('div.s-text', h('div.s-label', changed ? '• ' : '', c.label), changed ? h('div.s-desc', `Default: ${d[c.id] || 'none'}`) : null),
        h('kbd.sc-key', key || '—')));
    }
    if (!this.list.children.length) this.list.append(h('p.sv-empty', 'No command matches.'));
  }

  /** Gives `combo` ("" = none) to command `id`; a command that had it loses it. */
  save(id, combo) {
    const d = this.defaults();
    const o = { ...this.overrides() };
    if (combo) for (const other of conflictsOf(combo, id, d, o)) o[other] = '';
    if (combo === (d[id] || '')) delete o[id]; else o[id] = combo;
    this.set({ keyBindings: normalizeBindings(o, d) });
    this.render();
  }

  edit(c) {
    const d = this.defaults(), o = this.overrides();
    const label = (id) => (this.commands().find((x) => x.id === id) || { label: id }).label;
    let combo = effectiveKey(c.id, d, o);
    const shown = h('kbd.sc-capture-key', combo || '—');
    const msg = h('div.s-desc.sc-msg', { 'aria-live': 'polite' });
    const check = () => {
      msg.classList.remove('error');
      if (!combo) { msg.textContent = 'No shortcut.'; return true; }
      const problem = comboProblem(combo);
      if (problem) { msg.textContent = problem; msg.classList.add('error'); return false; }
      const others = conflictsOf(combo, c.id, d, o).map(label);
      msg.textContent = others.length ? `Now the shortcut of ${others.join(', ')}: saving moves it here.`
        : BROWSER_KEYS.has(combo) ? 'The browser may keep this one for itself.' : '';
      return true;
    };
    const take = (k) => { combo = k; shown.textContent = k || '—'; check(); };
    const capture = h('div.sc-capture', { tabindex: '0', role: 'textbox', 'aria-label': 'Press the new shortcut' },
      h('div.s-desc', 'Press the new shortcut on the keyboard'), shown);
    capture.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey)) return; // closes / moves on
      const k = comboFromEvent(e, { mac: MAC });
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      typed.value = '';
      take(k);
    });
    const typed = h('input.input.sc-typed', { type: 'text', placeholder: 'or type it: Ctrl+Shift+K, Alt+↑, F6', 'aria-label': 'Type the shortcut', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off' });
    typed.addEventListener('input', () => {
      const v = typed.value.trim();
      if (!v) return;
      const k = parseCombo(v);
      if (k) take(k);
      else { msg.classList.add('error'); msg.textContent = 'Not a shortcut yet: write it like Ctrl+Shift+K or Alt+↑.'; }
    });
    const m = showModal(c.label, h('div.sc-edit', capture, typed, msg, h('p.s-desc', `Default: ${d[c.id] || 'none'}`)), {
      actions: [
        h('button.btn', { type: 'button', onclick: () => m.close(null) }, 'Cancel'),
        h('button.btn', { type: 'button', onclick: () => { this.save(c.id, ''); m.close(null); } }, 'No shortcut'),
        d[c.id] ? h('button.btn', { type: 'button', onclick: () => { this.save(c.id, d[c.id]); m.close(null); } }, 'Default') : null,
        h('button.btn.btn-primary', { type: 'button', onclick: () => { if (!check()) return; this.save(c.id, combo); m.close(null); } }, 'Save'),
      ],
    });
    check();
    requestAnimationFrame(() => capture.focus());
  }
}
