// ui/layout.js — adaptive layout (spec §3.5) and the drag handles.
//
// Window size classes, like Material's:
//   compact  < 600 px  phones: single pane, sidebar is a drawer
//   medium   < 840 px  small tablets / split-screen: collapsible sidebar
//   expanded ≥ 840 px  tablets & desktop: persistent sidebar, side-by-side
//                      editor + preview
// Re-evaluated on every resize, so Android multi-window (dragging the split
// between two apps) just works without losing state.

import { $ } from './dom.js';

export class Layout {
  constructor({ getSettings, saveSettings, onChange }) {
    this.app = $('#app');
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.onChange = onChange || (() => {});
    this.size = null;
    this.sidebarOpen = true;
    this.syncHeight();
    const vv = window.visualViewport;
    (vv || window).addEventListener('resize', () => this.syncHeight());
    if (vv) vv.addEventListener('scroll', () => { if (vv.offsetTop > 0) window.scrollTo(0, 0); });
    window.addEventListener('resize', () => this.evaluate());
    this.evaluate();
    this.bindResizers();
    $('#scrim').addEventListener('click', () => this.closeDrawer());
  }

  /** Keeps #app exactly as tall as the visible area (keyboard included). */
  syncHeight() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
  }

  evaluate() {
    const w = window.innerWidth;
    const size = w < 600 ? 'compact' : w < 840 ? 'medium' : 'expanded';
    if (size === this.size) return;
    const prev = this.size;
    this.size = size;
    this.app.classList.remove('layout-compact', 'layout-medium', 'layout-expanded');
    this.app.classList.add(`layout-${size}`);
    if (size === 'compact') { this.app.classList.remove('drawer-open'); this.app.classList.remove('sidebar-hidden'); }
    else if (prev === 'compact' || prev === null) this.app.classList.toggle('sidebar-hidden', !this.sidebarOpen || size === 'medium');
    this.onChange(size, prev);
  }

  get compact() { return this.size === 'compact'; }

  isSidebarVisible() {
    return this.compact ? this.app.classList.contains('drawer-open') : !this.app.classList.contains('sidebar-hidden');
  }

  showSidebar(show = true) {
    if (this.compact) this.app.classList.toggle('drawer-open', show);
    else { this.app.classList.toggle('sidebar-hidden', !show); this.sidebarOpen = show; }
    this.onChange(this.size, this.size);
  }

  toggleSidebar() { this.showSidebar(!this.isSidebarVisible()); }

  closeDrawer() { if (this.compact) this.app.classList.remove('drawer-open'); }

  applySizes(s) {
    document.documentElement.style.setProperty('--sidebar-w', `${s.sidebarWidth}px`);
    document.documentElement.style.setProperty('--panel-h', `${Math.min(s.panelHeight, Math.round(window.innerHeight * 0.8))}px`);
  }

  bindResizers() {
    drag($('#sidebar-resizer'), {
      start: () => $('#sidebar').getBoundingClientRect().width,
      move: (w0, dx) => document.documentElement.style.setProperty('--sidebar-w', `${Math.max(160, Math.min(600, w0 + dx))}px`),
      end: () => { const s = this.getSettings(); s.sidebarWidth = Math.round($('#sidebar').getBoundingClientRect().width); this.saveSettings(s); },
    });
    drag($('#pane-divider'), {
      start: () => {
        const area = $('#editor-area').getBoundingClientRect();
        const first = $('#pane-0').getBoundingClientRect();
        return { area, first };
      },
      move: ({ area, first }, dx, dy) => {
        const vertical = this.compact;
        const total = vertical ? area.height : area.width;
        const size = (vertical ? first.height + dy : first.width + dx) / total;
        const f = Math.max(0.15, Math.min(0.85, size));
        $('#pane-0').style.flex = `${f} 1 0`;
        const second = $('#pane-1').classList.contains('hidden') ? $('#preview-side') : $('#pane-1');
        second.style.flex = `${1 - f} 1 0`;
      },
    });
  }
}

function drag(handle, { start, move, end }) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    const s0 = start();
    const x0 = e.clientX, y0 = e.clientY;
    const onMove = (ev) => move(s0, ev.clientX - x0, ev.clientY - y0);
    const onUp = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      end && end();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}
