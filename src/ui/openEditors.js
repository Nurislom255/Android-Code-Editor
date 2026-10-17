// ui/openEditors.js — "Open editors" above the file tree (VS Code's list of
// open tabs): every open file with its unsaved dot and a close button, by
// pane when the editor is split. Folded to one line by default (a phone has
// little room); tapping its title opens it.
//
// Long-press (right-click) a row: the tab's menu. Keep moving to drag it: the
// tab moves to that place in its pane, or into the other pane.

import { h, icon } from './dom.js';
import { dragMove } from './dragMove.js';
import { fileIcon } from './fileTypeIcons.js';
import { dirname } from '../core/paths.js';

export class OpenEditors {
  /**
   * @param {object} deps {ws, show(paneIndex, docId), close(paneIndex, docId), getOpen(), setOpen(bool),
   *   menu(paneIndex, docId, at), place(fromPane, docId, toPane, beforeId), getSettings()}
   */
  constructor(el, deps) {
    this.el = el;
    this.deps = deps;
    this.el.classList.add('open-editors');
    this.head = h('button.oe-head', { type: 'button', 'aria-expanded': 'false', onclick: () => { this.deps.setOpen(!this.deps.getOpen()); this.render(); } },
      h('span.twisty', { html: icon('chevronRight', 14) }), h('span.oe-title', 'Open editors'), h('span.oe-count'));
    this.list = h('div.oe-list', { role: 'list' });
    this.el.append(this.head, this.list);
    dragMove(this.list, '.oe-row', {
      axis: 'y',
      lockAxis: true,
      ignore: '.oe-close',
      getSettings: deps.getSettings,
      menu: (row, at) => deps.menu(Number(row.dataset.pane), Number(row.dataset.docId), at),
      find: (row, el, x, y) => this.dropTarget(row, el, y),
      drop: (row, t) => deps.place(Number(row.dataset.pane), Number(row.dataset.docId), t.pane, t.before),
      onDragChange: (on) => { this.dragging = on; if (!on) { this.sig = null; this.render(); } },
    });
  }

  /** Before or after the row under the finger (its pane); a pane's title = the start of that pane; below = the end. */
  dropTarget(row, el, y) {
    if (!el || !this.list.contains(el)) return null;
    const over = el.closest('.oe-row, .oe-group');
    if (over === row) return null;
    const slot = (next, pane) => ({
      pane, before: next && next.matches('.oe-row') && Number(next.dataset.pane) === pane ? Number(next.dataset.docId) : null,
      slot: { parent: this.list, before: next },
    });
    const after = (n) => { let x = n.nextElementSibling; if (x === row) x = x.nextElementSibling; return x; };
    if (!over) {
      const rows = [...this.list.querySelectorAll('.oe-row')].filter((r) => r !== row);
      const last = rows[rows.length - 1];
      return slot(null, last ? Number(last.dataset.pane) : Number(row.dataset.pane));
    }
    const pane = Number(over.dataset.pane);
    if (over.matches('.oe-group')) return slot(after(over), pane);
    const r = over.getBoundingClientRect();
    return y < r.top + r.height / 2 ? slot(over, pane) : slot(after(over), pane);
  }

  render() {
    if (this.dragging) return; // not under the finger: after the drag
    const { ws } = this.deps;
    const open = this.deps.getOpen();
    const panes = ws.panes.filter((p) => p && p.visible !== false && p.tabs.length);
    const count = panes.reduce((n, p) => n + p.tabs.length, 0);
    this.el.classList.toggle('open', open);
    this.head.setAttribute('aria-expanded', String(open));
    this.head.querySelector('.oe-count').textContent = count ? String(count) : '';
    const dirty = panes.some((p) => p.tabs.some((id) => ws.docs.get(id)?.dirty));
    this.head.classList.toggle('dirty', dirty);
    // Same signature → leave the rows alone (a tap may be on them).
    const sig = JSON.stringify([open, ws.activePane, panes.map((p) => [p.index, p.activeId, p.tabs.map((id) => { const d = ws.docs.get(id); return d && [d.name, d.path, d.dirty, !!d.preview]; })])]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.list.textContent = '';
    if (!open) return;
    for (const p of panes) {
      if (panes.length > 1) this.list.append(h('div.oe-group', { dataset: { pane: p.index } }, p.index === 0 ? (ws.panes[1] && ws.panes[1].visible !== false ? 'Left / top' : '') : 'Right / bottom'));
      for (const id of p.tabs) {
        const d = ws.docs.get(id);
        if (!d) continue;
        const active = p.activeId === id && ws.activePane === p.index;
        this.list.append(h('div.oe-row', {
          role: 'listitem', class: `${active ? 'active' : ''} ${d.dirty ? 'dirty' : ''} ${d.preview ? 'preview' : ''}`,
          dataset: { docId: id, pane: p.index }, title: d.path || d.name,
          onclick: (e) => { if (!e.target.closest('.oe-close')) this.deps.show(p.index, id); },
        },
        fileIcon(d.name),
        h('span.oe-name', d.name),
        d.path && dirname(d.path) ? h('span.oe-dir', dirname(d.path)) : null,
        h('button.oe-close', { type: 'button', 'aria-label': `Close ${d.name}`, title: d.dirty ? 'Unsaved — close…' : 'Close', html: icon('close', 14), onclick: () => this.deps.close(p.index, id) })));
      }
    }
  }
}
