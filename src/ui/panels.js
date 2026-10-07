// ui/panels.js — Search, Outline and Local History side panels, plus the diff view.

import { h, icon, debounce, formatTime } from './dom.js';
import { buildMatcher, findInText } from '../core/search.js';
import { flattenSymbols, symbolPathAt, KIND_ICONS } from '../editor/outline.js';
import { unifiedRows } from '../core/lineDiff.js';
import { showModal } from './overlays.js';

// ---- Project search (spec §2 Phase 2) ---------------------------------------

export class SearchPanel {
  /**
   * @param {HTMLElement} el
   * @param {{listFiles:()=>Promise<string[]>, readText:(path)=>Promise<string|null>, open:(path,line,col,len)=>void}} deps
   */
  constructor(el, deps) {
    this.el = el;
    this.deps = deps;
    this.opts = { regex: false, caseSensitive: false, wholeWord: false };
    this.gen = 0;
    const toggle = (key, label, title) => {
      const b = h('button.chip', { type: 'button', title, 'aria-pressed': 'false', onclick: () => {
        this.opts[key] = !this.opts[key];
        b.classList.toggle('on', this.opts[key]);
        b.setAttribute('aria-pressed', String(this.opts[key]));
        this.run();
      } }, label);
      return b;
    };
    this.input = h('input.input', { type: 'search', placeholder: 'Search in project', 'aria-label': 'Search in project', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
    this.include = h('input.input', { type: 'text', placeholder: 'Only in paths containing… (e.g. src/ or .css)', 'aria-label': 'Files to include', spellcheck: 'false', autocapitalize: 'off' });
    this.summary = h('div.search-summary');
    this.results = h('div.panel-scroll');
    el.append(
      h('div.panel-header', h('span.title', 'Search')),
      h('div.form-stack', this.input,
        h('div.toggle-row', toggle('caseSensitive', 'Aa', 'Match case'), toggle('wholeWord', 'ab|', 'Whole word'), toggle('regex', '.*', 'Regular expression')),
        this.include),
      this.summary, this.results,
    );
    const later = debounce(() => this.run(), 350);
    this.input.addEventListener('input', later);
    this.include.addEventListener('input', later);
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { later.cancel(); this.run(); } });
  }

  focus(text) {
    if (text) { this.input.value = text; this.run(); }
    this.input.focus();
    this.input.select();
  }

  async run() {
    const my = ++this.gen;
    const q = this.input.value;
    this.results.textContent = '';
    if (!q) { this.summary.textContent = ''; return; }
    let matcher;
    try {
      matcher = buildMatcher(q, this.opts);
    } catch (err) {
      this.summary.textContent = err.message;
      return;
    }
    this.summary.textContent = 'Searching…';
    const filter = this.include.value.trim();
    const files = (await this.deps.listFiles()).filter((p) => !filter || p.includes(filter));
    let total = 0, fileCount = 0;
    const started = performance.now();
    for (let i = 0; i < files.length; i++) {
      if (my !== this.gen) return;
      const text = await this.deps.readText(files[i]);
      if (text == null) continue;
      const hits = findInText(text, matcher, 200);
      if (!hits.length) continue;
      total += hits.length;
      fileCount++;
      this.results.append(this.renderFile(files[i], hits));
      if (i % 25 === 0) this.summary.textContent = `Searching… ${total} results in ${fileCount} files`;
      if (total > 5000) break;
    }
    if (my !== this.gen) return;
    this.summary.textContent = total
      ? `${total} result${total === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'} (${Math.round(performance.now() - started)} ms)`
      : `No results in ${files.length} files.`;
  }

  renderFile(path, hits) {
    const lines = h('div');
    for (const m of hits) {
      const pre = m.preview.slice(0, m.previewStart);
      const hit = m.preview.slice(m.previewStart, m.previewStart + m.length);
      const post = m.preview.slice(m.previewStart + m.length);
      lines.append(h('button.result-line', { type: 'button', onclick: () => this.deps.open(path, m.line, m.col + 1, m.length) },
        h('span.ln', String(m.line)), h('span.txt', pre, h('mark', hit), post)));
    }
    let open = true;
    const header = h('button.result-file', { type: 'button', onclick: () => { open = !open; lines.classList.toggle('hidden', !open); } },
      h('span', { html: icon('file', 14) }), path, h('span.count', String(hits.length)));
    return h('div', header, lines);
  }
}

// ---- Outline -----------------------------------------------------------------

export class OutlinePanel {
  constructor(el, { getSymbols, reveal }) {
    this.el = el;
    this.getSymbols = getSymbols;
    this.reveal = reveal;
    this.filter = h('input.input', { type: 'search', placeholder: 'Filter symbols', 'aria-label': 'Filter symbols', spellcheck: 'false', autocapitalize: 'off' });
    this.list = h('div.panel-scroll');
    el.append(h('div.panel-header', h('span.title', 'Outline')), h('div.form-stack', this.filter), this.list);
    this.filter.addEventListener('input', () => this.render());
    this.cursor = 0;
  }

  setCursor(pos) {
    this.cursor = pos;
    this.markCurrent();
  }

  render() {
    const data = this.getSymbols();
    this.list.textContent = '';
    if (!data) { this.list.append(h('div.panel-note', 'Open a file to see its functions, classes and headings.')); return; }
    const flat = flattenSymbols(data.symbols);
    const q = this.filter.value.trim().toLowerCase();
    const shown = q ? flat.filter((s) => s.name.toLowerCase().includes(q)) : flat;
    if (!shown.length) {
      this.list.append(h('div.panel-note', data.lezer ? 'No symbols found.' : `Outline isn't available for ${data.langName} (no full parser).`));
      return;
    }
    this.rows = [];
    for (const s of shown) {
      const row = h('button.outline-row', { type: 'button', style: { '--depth': q ? 0 : s.depth }, onclick: () => this.reveal(s.from) },
        h('span.kind', KIND_ICONS[s.kind] || '•'), h('span.oname', s.name), h('span.oline', String(s.line)));
      row._sym = s;
      this.rows.push(row);
      this.list.append(row);
    }
    this.symbols = data.symbols;
    this.markCurrent();
  }

  markCurrent() {
    if (!this.rows || !this.symbols) return;
    const path = symbolPathAt(this.symbols, this.cursor);
    const cur = path[path.length - 1];
    for (const r of this.rows) r.classList.toggle('current', r._sym === cur);
  }
}

// ---- Local history (spec §2 Phase 2) ------------------------------------------

export class HistoryPanel {
  constructor(el, { getDoc, list, currentText, restore }) {
    this.el = el;
    this.deps = { getDoc, list, currentText, restore };
    this.body = h('div.panel-scroll');
    el.append(h('div.panel-header', h('span.title', 'Local history')), this.body);
  }

  async render() {
    const gen = this.gen = (this.gen || 0) + 1;
    const doc = this.deps.getDoc();
    if (!doc || doc.kind !== 'project') {
      this.body.textContent = '';
      this.body.append(h('div.panel-note', 'Every save of a project file keeps a snapshot here (independent of git), so you can go back to "the version from an hour ago".'));
      return;
    }
    const items = await this.deps.list(doc.key);
    if (gen !== this.gen) return; // a newer render started meanwhile
    this.body.textContent = '';
    this.body.append(h('div.panel-note', h('b', doc.path), ` — ${items.length} snapshot${items.length === 1 ? '' : 's'}`));
    for (const it of items) {
      this.body.append(h('div.list-row',
        h('div.grow', h('div', formatTime(it.time)), h('div.meta', `${it.label || 'Saved'} · ${it.size.toLocaleString()} chars`)),
        h('button.btn.btn-small', { type: 'button', onclick: () => this.compare(doc, it) }, 'Compare'),
        h('button.btn.btn-small', { type: 'button', onclick: () => this.deps.restore(doc, it.content) }, 'Restore')));
    }
  }

  compare(doc, it) {
    let m = null;
    const restore = h('button.btn.btn-primary', { type: 'button', onclick: () => { this.deps.restore(doc, it.content); m.close(); } }, 'Restore this snapshot');
    m = showDiff(`${doc.name}: snapshot (${formatTime(it.time)}) → current`, it.content, this.deps.currentText(doc), [restore]);
  }
}

// ---- Diff view ----------------------------------------------------------------

export function renderDiff(oldText, newText) {
  const rows = unifiedRows(oldText, newText);
  const box = h('div.diff', { role: 'table', 'aria-label': 'Differences' });
  if (!rows.length) { box.append(h('div.diff-empty', 'No differences.')); return box; }
  for (const r of rows) {
    const sign = r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : r.kind === 'hunk' ? '' : ' ';
    box.append(h(`div.diff-row.${r.kind}`, h('span.dn', r.oldNo ?? ''), h('span.dn', r.newNo ?? ''), h('span.dt', sign + (r.text ?? ''))));
  }
  return box;
}

export function showDiff(title, oldText, newText, actions = null) {
  return showModal(title, renderDiff(oldText, newText), { className: 'wide', actions });
}
