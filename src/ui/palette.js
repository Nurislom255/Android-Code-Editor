// ui/palette.js — one overlay for the command palette (>), Quick Open (file
// names), Go to Line (:) and Go to Symbol (@) — the most important feature for
// a small screen: every command is reachable by typing a few letters, no menus.

import { h } from './dom.js';
import { fuzzyFilter } from '../core/fuzzy.js';

function highlight(text, positions) {
  if (!positions || !positions.length) return [text];
  const set = new Set(positions);
  const out = [];
  let buf = '';
  let on = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== on) { if (buf) out.push(on ? h('b', buf) : buf); buf = ''; on = hit; }
    buf += text[i];
  }
  if (buf) out.push(on ? h('b', buf) : buf);
  return out;
}

export class Palette {
  /**
   * @param {object} providers
   *  commands(): {id,label,detail?,key?,run}[]
   *  files(): Promise<string[]>
   *  symbols(): {label,detail,run}[]
   *  gotoLine(n:number, col:number): void
   *  lineInfo(): string
   */
  constructor(providers) {
    this.p = providers;
    this.layer = null;
  }

  get isOpen() { return !!this.layer; }

  close(result = null) {
    if (!this.layer) return;
    this.layer.remove();
    this.layer = null;
    if (this.resolve) { this.resolve(result); this.resolve = null; }
    if (this.restoreFocus && document.contains(this.restoreFocus)) this.restoreFocus.focus({ preventScroll: true });
  }

  /** Opens with a prefix: '>' commands, '' files, ':' line, '@' symbols. */
  open(prefix = '>') {
    this.show({ initial: prefix, dynamic: true });
  }

  /**
   * Generic picker: resolves with the chosen item or null.
   * @param {{label:string, detail?:string}[]} items
   */
  pick(items, { placeholder = 'Type to filter', initial = '' } = {}) {
    return new Promise((resolve) => {
      this.show({ initial, items, placeholder, onPick: (it) => this.close(it) });
      this.resolve = resolve;
    });
  }

  show({ initial, dynamic = false, items = null, placeholder = '', onPick = null }) {
    this.close();
    this.restoreFocus = document.activeElement;
    const input = h('input.input.palette-input', {
      type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
      'aria-label': 'Command palette', placeholder: placeholder || 'Search files by name · > commands · : line · @ symbol',
    });
    const hint = h('div.palette-hint');
    const list = h('div.palette-list', { role: 'listbox' });
    const box = h('div.palette', { role: 'dialog', 'aria-modal': 'true' }, input, hint, list);
    this.layer = h('div.palette-layer', { onpointerdown: (e) => { if (e.target === this.layer) this.close(); } }, box);
    document.getElementById('overlay-root').append(this.layer);
    input.value = initial;

    let results = [];
    let sel = 0;
    let gen = 0;
    let fileCache = null;

    const render = () => {
      list.textContent = '';
      if (!results.length) { list.append(h('div.palette-empty', 'No matches')); return; }
      results.slice(0, 200).forEach((r, i) => {
        const it = r.item;
        const row = h('button.palette-item', {
          role: 'option', 'aria-selected': i === sel ? 'true' : 'false', class: i === sel ? 'sel' : '',
          onclick: () => choose(i),
        }, h('span.pi-label', highlight(it.label, r.positions)), it.detail ? h('span.pi-detail', it.detail) : null, it.key ? h('span.pi-key', it.key) : null);
        list.append(row);
      });
      const cur = list.children[sel];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    };

    const choose = (i) => {
      const r = results[i];
      if (!r) return;
      if (onPick) { onPick(r.item); return; }
      this.close();
      r.item.run();
    };

    const update = async () => {
      const my = ++gen;
      const v = input.value;
      sel = 0;
      if (items) {
        hint.textContent = '';
        results = fuzzyFilter(v, items, (x) => x.label);
        render();
        return;
      }
      if (!dynamic) return;
      if (v.startsWith('>')) {
        hint.textContent = 'Commands';
        results = fuzzyFilter(v.slice(1).trim(), this.p.commands(), (c) => c.label);
      } else if (v.startsWith(':')) {
        const m = /^:\s*(\d+)?(?::(\d+))?/.exec(v);
        hint.textContent = this.p.lineInfo();
        results = m && m[1] ? [{ item: { label: `Go to line ${m[1]}${m[2] ? `, column ${m[2]}` : ''}`, run: () => this.p.gotoLine(Number(m[1]), Number(m[2] || 1)) }, positions: [] }] : [];
      } else if (v.startsWith('@')) {
        hint.textContent = 'Symbols in this file';
        results = fuzzyFilter(v.slice(1).trim(), this.p.symbols(), (s) => s.label);
      } else {
        hint.textContent = 'Files — type > for commands, : for a line, @ for symbols';
        if (!fileCache) fileCache = await this.p.files();
        if (my !== gen) return;
        results = fuzzyFilter(v.trim(), fileCache.map((path) => ({ label: path, path, run: () => this.p.openFile(path) })), (f) => f.label, 200);
      }
      render();
    };

    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    });
    update();
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
  }
}
