// ui/keysBarEditor.js — Settings → Keys bar (ROADMAP 2.7): the bar of each
// device as it looks, where a tap on a key moves, replaces or removes it;
// the symbol keys of each language with their swipes; import / export.
//
// Tab, ⋯ (all keys) and Mod — or Ctrl, Shift and Alt — always stay (owner's
// decision): every other key is one tap away in ⋯ whatever is removed here.

import { h } from './dom.js';
import { popupMenu, prompt, confirm, showModal, toast, showJson } from './overlays.js';
import {
  DEFAULT_BAR, DEFAULT_LAYOUTS, BAR_KEYS, BAR_PROFILES, MORE_GROUPS,
  barFor, barProblem, barKeyInfo, normalizeBar, parseToken, parseLayout, formatLayout, tokenProblem, catalogId,
} from '../core/keysLayout.js';

const LAYOUT_NAMES = { js: 'JavaScript / TypeScript', html: 'HTML / XML', css: 'CSS', python: 'Python', clike: 'C / C++ / Java / Kotlin / Rust…', markdown: 'Markdown', json: 'JSON', plain: 'Other files' };
const SYM_ON_BAR = (bar) => bar.flat().filter((k) => k === 'sym').length;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const at = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; };

/** The visual editor of the bar's layout, one device type at a time. */
export class BarEditor {
  constructor({ get, set, profile }) {
    this.get = get;
    this.set = set;
    this.device = profile;
    this.profile = profile;
    this.el = h('div.kbe', { dataset: { search: 'keys bar layout customize add remove move replace key row tab mod joystick undo phone tablet landscape', stub: 'Keys bar layout: add, move, remove keys ›' } });
    this.render();
  }

  rows() { return barFor(this.get().keysBar, this.profile).map((r) => r.slice()); }

  save(rows) {
    const problem = barProblem(rows, this.profile);
    if (problem) { toast(problem, 'warn'); return false; }
    const all = { ...this.get().keysBar };
    if (same(rows, DEFAULT_BAR[this.profile])) delete all[this.profile]; else all[this.profile] = rows;
    this.set({ keysBar: normalizeBar(all) });
    this.render();
    return true;
  }

  render() {
    const rows = this.rows();
    const p = BAR_PROFILES[this.profile];
    const custom = !!this.get().keysBar[this.profile];
    this.el.textContent = '';
    this.el.className = `kbe kbe-${this.profile}`;
    this.el.append(
      h('div.kbe-tabs', { role: 'tablist', 'aria-label': 'Device' }, Object.entries(BAR_PROFILES).map(([id, info]) => h('button.kbe-tab', {
        type: 'button', role: 'tab', 'aria-selected': id === this.profile ? 'true' : 'false',
        onclick: () => { this.profile = id; this.render(); },
      }, info.name, id === this.device ? h('span.kbe-here', ' · this device') : null))),
      h('p.s-desc.kbe-help', 'Tap a key to move, replace or remove it; + adds one. ', h('b', 'ctx'), ' keys follow the code, ', h('b', 'sym'), ' keys are the language\'s symbols (below). Tab, ⋯ and Mod (or Ctrl, Shift and Alt) always stay.'),
      ...rows.map((row, i) => h('div.kbe-row-wrap',
        h('div.kbe-row-name', p.rows[i]),
        h('div.kbe-row', { role: 'list', 'aria-label': p.rows[i] },
          ...row.map((id, j) => this.keyButton(id, i, j, rows)),
          row.length < p.max ? h('button.kbe-add', { type: 'button', 'aria-label': `Add a key to the ${p.rows[i].toLowerCase()}`, title: 'Add a key', onclick: async () => {
            const id = await pickKey('Add a key');
            if (id) { rows[i].push(id); this.save(rows); }
          } }, '+') : null))),
      h('div.kbe-actions',
        custom ? h('button.btn.btn-small', { type: 'button', onclick: () => { const all = { ...this.get().keysBar }; delete all[this.profile]; this.set({ keysBar: all }); this.render(); } }, 'Reset this layout') : h('span.s-desc', 'Default layout'),
        this.profile === 'phone' && rows.some((r) => r.length > 7) ? h('span.s-desc.kbe-warn', 'Over 7 keys a row: narrow on small phones.') : null),
    );
  }

  keyButton(id, i, j, rows) {
    const info = barKeyInfo(id) || { label: id, title: id };
    const kind = BAR_KEYS[id] ? (id === 'ctx' || id === 'sym' ? id : 'special') : id.startsWith('@') ? 'action' : 'symbol';
    const btn = h(`button.kbe-key.kbe-${kind}`, { type: 'button', role: 'listitem', title: info.title, 'aria-label': `${info.title} (row ${i + 1}, key ${j + 1})` }, info.label);
    btn.addEventListener('click', () => {
      const move = (fn) => { const next = rows.map((r) => r.slice()); fn(next); this.save(next); };
      const other = rows.length > 1 ? 1 - i : -1;
      popupMenu([
        { label: 'Replace with…', run: async () => { const k = await pickKey(`Replace ${info.label}`); if (k) move((n) => { n[i][j] = k; }); } },
        { label: 'Move left', disabled: j === 0, run: () => move((n) => { [n[i][j - 1], n[i][j]] = [n[i][j], n[i][j - 1]]; }) },
        { label: 'Move right', disabled: j === rows[i].length - 1, run: () => move((n) => { [n[i][j + 1], n[i][j]] = [n[i][j], n[i][j + 1]]; }) },
        other >= 0 ? { label: `Move to the ${BAR_PROFILES[this.profile].rows[other].toLowerCase()}`, disabled: rows[other].length >= BAR_PROFILES[this.profile].max,
          run: () => move((n) => { n[other].push(n[i].splice(j, 1)[0]); }) } : null,
        '-',
        { label: 'Remove', danger: true, run: () => move((n) => { n[i].splice(j, 1); }) },
      ].filter(Boolean), at(btn));
    });
    return btn;
  }
}

/** A modal listing every key the bar can hold → the chosen id, or null. */
export function pickKey(title) {
  return new Promise((resolve) => {
    let done = false;
    const choose = (id) => { done = true; m.close(null); resolve(id); };
    const item = (id) => {
      const info = barKeyInfo(id);
      return h('button.kbe-pick', { type: 'button', title: info.title, onclick: () => choose(id) }, h('span.kbe-pick-label', info.label), h('span.kbe-pick-desc', info.title));
    };
    const groups = [
      ['Bar keys', Object.keys(BAR_KEYS)],
      ...MORE_GROUPS.map(([name, keys]) => [name, keys.map(catalogId).filter((k) => barKeyInfo(k))]),
    ];
    const custom = h('button.btn.btn-small', { type: 'button', onclick: async () => {
      const t = await prompt({ title: 'Your own symbol key', label: 'What it types, e.g. ;  or  ->  (variants after ^, e.g. (^)^[])', okLabel: 'Add',
        validate: (v) => (/\s/.test(v) ? 'No spaces.' : v.length > 40 ? 'Too long.' : null) });
      if (t) choose(`s:${t}`);
    } }, 'Your own symbol…');
    const m = showModal(title, h('div.kbe-picker', ...groups.map(([name, ids]) => h('div.kbe-pick-group', h('div.kbe-pick-title', name), h('div.kbe-pick-list', ids.map(item)))), h('div.kbe-pick-group', custom)), {
      className: 'wide',
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

/** The symbol keys of each language: tap, four swipes, the hold menu. */
export class SymbolSetsEditor {
  constructor({ get, set, profile }) {
    this.get = get;
    this.set = set;
    this.profile = profile;
    this.group = 'js';
    this.asText = false;
    this.el = h('div.sse', { dataset: { search: words('symbol keys per language swipe variants hold', ...Object.values(LAYOUT_NAMES)), stub: 'Symbol keys per language ›' } });
    this.render();
  }

  tokens() { return parseLayout(this.get().keysLayouts[this.group] || DEFAULT_LAYOUTS[this.group]); }

  save(keys) {
    const text = formatLayout(keys);
    if (!keys.length) { toast('Keep at least one key.', 'warn'); return; }
    this.set({ keysLayouts: { ...this.get().keysLayouts, [this.group]: text } });
    this.render();
  }

  render() {
    const keys = this.tokens();
    const onBar = SYM_ON_BAR(barFor(this.get().keysBar, this.profile));
    const edited = this.get().keysLayouts[this.group] !== DEFAULT_LAYOUTS[this.group];
    this.el.textContent = '';
    const pick = h('select.select', { 'aria-label': 'Language', onchange: (e) => { this.group = e.target.value; this.render(); } },
      Object.entries(LAYOUT_NAMES).map(([g, name]) => h('option', { value: g, selected: g === this.group }, name)));
    this.el.append(
      h('div.setting', h('div.s-text', h('div.s-label', 'Language'), h('div.s-desc', `The first ${onBar} are on the bar here; the rest fill empty context keys and are all in ⋯.`)), pick),
    );
    if (this.asText) {
      const ta = h('textarea.input.input-multiline', { rows: 3, 'aria-label': `Keys for ${LAYOUT_NAMES[this.group]}`, spellcheck: 'false', autocapitalize: 'off' });
      ta.value = this.get().keysLayouts[this.group];
      ta.addEventListener('change', () => { this.set({ keysLayouts: { ...this.get().keysLayouts, [this.group]: ta.value } }); });
      this.el.append(h('p.s-desc', 'Space-separated keys; ^ separates a key from its variants: (^)^[]^{} = tap (, swipe up ), down [], left {}.'), ta);
    } else {
      this.el.append(h('div.sse-keys', { role: 'list', 'aria-label': `Symbol keys for ${LAYOUT_NAMES[this.group]}` },
        ...keys.map((k, i) => this.chip(k, i, keys, i < onBar)),
        h('button.kbe-add', { type: 'button', 'aria-label': 'Add a symbol key', title: 'Add a symbol key', onclick: async () => {
          const k = await editToken(null);
          if (k) this.save([...keys, k]);
        } }, '+')));
    }
    this.el.append(h('div.kbe-actions',
      h('button.btn.btn-small', { type: 'button', onclick: () => { this.asText = !this.asText; this.render(); } }, this.asText ? 'Edit as keys' : 'Edit as text'),
      edited ? h('button.btn.btn-small', { type: 'button', onclick: () => { this.set({ keysLayouts: { ...this.get().keysLayouts, [this.group]: DEFAULT_LAYOUTS[this.group] } }); this.render(); } }, `Reset ${LAYOUT_NAMES[this.group]}`) : null));
  }

  chip(k, i, keys, onBar) {
    const hints = k.alts.slice(0, 4).map((a, n) => h('span.sse-alt', `${'↑↓←→'[n]}${a}`));
    const btn = h(`button.sse-key${onBar ? '.on-bar' : ''}`, { type: 'button', role: 'listitem', title: `${k.label}${k.alts.length ? ` — ${k.alts.join(' ')}` : ''}${onBar ? ' (on the bar)' : ''}` },
      h('span.sse-label', k.label), h('span.sse-alts', ...hints, k.alts.length > 4 ? h('span.sse-alt', `+${k.alts.length - 4}`) : null));
    btn.addEventListener('click', () => {
      const put = (fn) => { const next = keys.slice(); fn(next); this.save(next); };
      popupMenu([
        { label: 'Edit…', run: async () => { const t = await editToken(k); if (t) put((n) => { n[i] = t; }); } },
        { label: 'Move left', disabled: i === 0, run: () => put((n) => { [n[i - 1], n[i]] = [n[i], n[i - 1]]; }) },
        { label: 'Move right', disabled: i === keys.length - 1, run: () => put((n) => { [n[i + 1], n[i]] = [n[i], n[i + 1]]; }) },
        '-',
        { label: 'Remove', danger: true, run: () => put((n) => { n.splice(i, 1); }) },
      ], at(btn));
    });
    return btn;
  }
}

/**
 * One symbol key: what a tap types, each swipe, and the rest of the hold menu.
 * → the key (as parseToken gives it) or null.
 */
export function editToken(k) {
  return new Promise((resolve) => {
    let done = false;
    const alts = k ? k.alts : [];
    const fields = [
      ['Tap', k ? k.insert : ''],
      ['Swipe up', alts[0] || ''],
      ['Swipe down', alts[1] || ''],
      ['Swipe left', alts[2] || ''],
      ['Swipe right', alts[3] || ''],
    ].map(([label, value]) => {
      const input = h('input.input', { type: 'text', value, 'aria-label': label, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
      return { label, input };
    });
    const more = h('input.input', { type: 'text', value: alts.slice(4).join(' '), 'aria-label': 'Only in the hold menu', placeholder: 'space-separated', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
    const error = h('div.field-error');
    const submit = () => {
      const vals = fields.map((f) => f.input.value.trim());
      const extra = more.value.trim().split(/\s+/).filter(Boolean);
      const problem = tokenProblem(vals, extra);
      if (problem) { error.textContent = problem; return; }
      const parts = [vals[0], ...vals.slice(1).filter(Boolean), ...extra];
      done = true;
      m.close(null);
      resolve(parseToken(parts.join('^')));
    };
    const m = showModal(k ? `Key ${k.label}` : 'New symbol key', h('div.sse-form',
      ...fields.map((f) => h('label.field', h('span.field-label', f.label), f.input)),
      h('label.field', h('span.field-label', 'Only in the hold menu'), more),
      h('p.s-desc', 'Holding the key shows all of them. Swipes are filled in order: leave the later ones empty.'),
      error), {
      actions: [h('button.btn', { type: 'button', onclick: () => m.close(null) }, 'Cancel'), h('button.btn.btn-primary', { type: 'button', onclick: submit }, 'Save')],
      onClose: () => { if (!done) resolve(null); },
    });
    requestAnimationFrame(() => fields[0].input.focus());
  });
}

/** Export / import / reset of everything on this page. */
export function keysBarTransfer({ get, set, rerender }) {
  const data = () => {
    const s = get();
    const layouts = Object.fromEntries(Object.entries(s.keysLayouts).filter(([g, v]) => v !== DEFAULT_LAYOUTS[g]));
    return { keysBar: s.keysBar, keysLayouts: layouts };
  };
  return h('div.setting', { dataset: { search: 'export import share reset keys bar json' } },
    h('div.s-text', h('div.s-label', 'Keys bar as JSON'), h('div.s-desc', 'The layouts and the symbol keys you changed.')),
    h('button.btn.btn-small', { type: 'button', onclick: () => showJson('Keys bar', data()) }, 'Export'),
    h('button.btn.btn-small', { type: 'button', onclick: async () => {
      const text = await prompt({ title: 'Import keys bar', label: 'Paste the exported JSON', multiline: true, okLabel: 'Import' });
      if (!text) return;
      let raw;
      try { raw = JSON.parse(text); } catch { toast('That is not valid JSON.', 'error'); return; }
      const bar = normalizeBar(raw && raw.keysBar);
      const layouts = { ...get().keysLayouts };
      for (const [g, v] of Object.entries((raw && raw.keysLayouts) || {})) if (g in DEFAULT_LAYOUTS && typeof v === 'string' && v.trim()) layouts[g] = v;
      set({ keysBar: bar, keysLayouts: layouts });
      toast('Keys bar imported.', 'success');
      rerender();
    } }, 'Import'),
    h('button.btn.btn-small.btn-danger', { type: 'button', onclick: async () => {
      if (!(await confirm('Reset the keys bar?', 'Every layout and symbol key goes back to the default.', 'Reset', 'danger'))) return;
      set({ keysBar: {}, keysLayouts: { ...DEFAULT_LAYOUTS } });
      rerender();
    } }, 'Reset'));
}

function words(...parts) { return parts.filter(Boolean).join(' ').toLowerCase(); }
