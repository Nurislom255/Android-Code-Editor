// ui/bottomPanel.js — Console (run output + stdin), Preview, Problems.

import { h, icon } from './dom.js';
import { linkify } from '../core/linkify.js';

const PREFIX = { log: '›', info: 'ℹ', warn: '⚠', error: '✖', result: '=', system: '·', input: '?' };

export class BottomPanel {
  /**
   * deps: {resolvePath(name)->path|null, openAt(path,line,col), onStop(), onRerun(), getSettings(), layoutChanged()}
   */
  constructor(deps) {
    this.deps = deps;
    this.el = document.getElementById('bottom-panel');
    this.actions = this.el.querySelector('.panel-actions');
    this.tab = 'console';
    for (const b of this.el.querySelectorAll('.panel-tab')) b.addEventListener('click', () => this.show(b.dataset.tab));
    this.buildConsole();
    this.buildPreview();
    this.problemsView = document.getElementById('problems-view');
    this.renderActions();
  }

  get visible() { return !this.el.classList.contains('collapsed'); }

  show(tab = this.tab) {
    this.tab = tab;
    this.el.classList.remove('collapsed');
    for (const b of this.el.querySelectorAll('.panel-tab')) {
      b.classList.toggle('active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    for (const v of this.el.querySelectorAll('.panel-view')) v.classList.toggle('hidden', v.dataset.tab !== tab);
    this.renderActions();
    this.deps.layoutChanged();
    if (tab === 'preview' && this.onShowPreview) this.onShowPreview();
    if (tab === 'problems' && this.onShowProblems) this.onShowProblems();
  }

  hide() {
    this.el.classList.add('collapsed');
    this.el.classList.remove('maximized');
    this.deps.layoutChanged();
  }

  toggle(tab) {
    if (this.visible && (!tab || tab === this.tab)) this.hide();
    else this.show(tab || this.tab);
  }

  renderActions() {
    const a = this.actions;
    a.textContent = '';
    const btn = (name, title, fn, cls = '') => h(`button.icon-btn.small${cls}`, { type: 'button', title, 'aria-label': title, icon: name, onclick: fn });
    if (this.tab === 'console') {
      this.stopBtn = btn('stop', 'Stop', () => this.deps.onStop());
      this.stopBtn.classList.toggle('hidden', !this.running);
      a.append(
        this.stopBtn,
        btn('play', 'Run again', () => this.deps.onRerun()),
        h('button.icon-btn.small', { type: 'button', title: 'Standard input for readline()', 'aria-label': 'Toggle stdin box', class: this.stdinBox.classList.contains('hidden') ? '' : 'active', onclick: (e) => {
          this.stdinBox.classList.toggle('hidden');
          e.currentTarget.classList.toggle('active', !this.stdinBox.classList.contains('hidden'));
        } }, 'stdin'),
        btn('clear', 'Clear console', () => this.clear()),
      );
    } else if (this.tab === 'preview') {
      a.append(...(this.previewActions ? this.previewActions() : []));
    }
    a.append(
      btn(this.el.classList.contains('maximized') ? 'minimize' : 'maximize', 'Maximize panel', () => { this.el.classList.toggle('maximized'); this.renderActions(); this.deps.layoutChanged(); }),
      btn('close', 'Close panel', () => this.hide()),
    );
  }

  // ---- console --------------------------------------------------------------

  buildConsole() {
    const view = document.getElementById('console-view');
    this.lines = h('div.console-lines', { role: 'log', 'aria-live': 'polite' });
    this.inputLabel = h('span.prompt-label');
    this.inputField = h('input.input', { type: 'text', placeholder: 'Type input and press Enter', 'aria-label': 'Program input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off' });
    this.inputRow = h('div.console-input-row.hidden', this.inputLabel, this.inputField,
      h('button.btn.btn-small', { type: 'button', onclick: () => this.submitInput() }, 'Send'));
    this.stdinArea = h('textarea.input', { rows: 3, placeholder: 'One line per readline() / input() call. Lines are used in order; when they run out, input() asks here interactively.', 'aria-label': 'Standard input', spellcheck: 'false', autocapitalize: 'off' });
    this.stdinBox = h('div.stdin-box.hidden', this.stdinArea, h('div.hint', 'readline() → next line (sync, null at end) · await input("q") → next line, or asks you'));
    view.append(this.lines, this.inputRow, this.stdinBox);
    this.inputField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submitInput(); } });
    this.lines.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-path]');
      if (!a) return;
      e.preventDefault();
      this.deps.openAt(a.dataset.path, Number(a.dataset.line), Number(a.dataset.col));
    });
  }

  get stdin() { return this.stdinArea.value; }

  setRunning(running) {
    this.running = running;
    if (this.stopBtn) this.stopBtn.classList.toggle('hidden', !running);
    if (!running) this.cancelInput();
  }

  clear() {
    this.lines.textContent = '';
  }

  /** @param {{level:string, text:string}} entry */
  log(entry) {
    const row = h(`div.console-line.${entry.level}`, h('span.prefix', PREFIX[entry.level] || '›'));
    const body = h('span.ctext');
    for (const part of linkify(entry.text, (p) => this.deps.resolvePath(p))) {
      if (part.path) body.append(h('a', { href: '#', dataset: { path: part.path, line: part.line, col: part.col } }, part.text));
      else body.append(part.text);
    }
    row.append(body);
    const atBottom = this.lines.scrollHeight - this.lines.scrollTop - this.lines.clientHeight < 40;
    this.lines.append(row);
    // Long-running chatty scripts: keep the DOM bounded.
    while (this.lines.children.length > 3000) this.lines.firstChild.remove();
    if (atBottom) this.lines.scrollTop = this.lines.scrollHeight;
  }

  system(text) { this.log({ level: 'system', text }); }

  /** Interactive input() — resolves with the typed line, or null if the run ends. */
  requestInput(promptText) {
    this.show('console');
    this.cancelInput();
    this.inputLabel.textContent = promptText || '›';
    this.inputRow.classList.remove('hidden');
    this.inputField.value = '';
    requestAnimationFrame(() => this.inputField.focus());
    return new Promise((resolve) => { this.inputResolve = resolve; });
  }

  submitInput() {
    if (!this.inputResolve) return;
    const v = this.inputField.value;
    this.log({ level: 'input', text: `${this.inputLabel.textContent} ${v}` });
    const r = this.inputResolve;
    this.inputResolve = null;
    this.inputRow.classList.add('hidden');
    r(v);
  }

  cancelInput() {
    if (this.inputResolve) { const r = this.inputResolve; this.inputResolve = null; r(null); }
    this.inputRow.classList.add('hidden');
  }

  // ---- preview -------------------------------------------------------------------

  buildPreview() {
    this.previewHost = document.getElementById('preview-view');
  }

  // ---- problems -------------------------------------------------------------------

  renderProblems(items) {
    const v = this.problemsView;
    v.textContent = '';
    const count = document.getElementById('problems-count');
    count.textContent = String(items.length);
    count.classList.toggle('hidden', items.length === 0);
    if (!items.length) { v.append(h('div.empty-note', 'No problems in open files.')); return; }
    const list = h('div.console-lines');
    for (const p of items) {
      list.append(h('div.problem-row', { role: 'button', tabindex: '0', onclick: () => this.deps.openAt(p.path, p.line, p.col, p.docId) },
        h('span.sev', { class: p.severity }, p.severity === 'error' ? '✖' : '⚠'),
        h('span', p.message),
        h('span.ploc', `${p.name}:${p.line}:${p.col}`)));
    }
    v.append(list);
  }
}

export { icon };
