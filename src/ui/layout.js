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

const SIDEBAR_MIN = 160; // px

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
    // Pulled narrower than half its smallest width, the sidebar hides when
    // let go (as in VS Code) — it comes back at its old width (Ctrl+B, or
    // the activity bar).
    drag($('#sidebar-resizer'), {
      start: () => $('#sidebar').getBoundingClientRect().width,
      move: (w0, dx) => {
        this.app.classList.toggle('sidebar-collapsing', w0 + dx < SIDEBAR_MIN / 2);
        document.documentElement.style.setProperty('--sidebar-w', `${Math.max(SIDEBAR_MIN, Math.min(600, w0 + dx))}px`);
      },
      end: (w0) => {
        if (this.app.classList.contains('sidebar-collapsing')) {
          this.app.classList.remove('sidebar-collapsing');
          document.documentElement.style.setProperty('--sidebar-w', `${Math.round(w0)}px`);
          this.showSidebar(false);
          return;
        }
        const s = this.getSettings(); s.sidebarWidth = Math.round($('#sidebar').getBoundingClientRect().width); this.saveSettings(s);
      },
    });
    // The code panes and the side preview: each divider moves only the
    // column before it and the one after it. Every column's share is set
    // from its size when the drag starts — computing one share from the
    // whole width (as before) made the divider jump when three columns
    // were shown (split code + preview).
    for (const id of ['#pane-divider', '#preview-divider']) {
      drag($(id), {
        start: (handle) => {
          const vertical = this.compact;
          const cols = [...$('#editor-area').children].filter((el) => el.matches('.pane, #preview-side') && !el.classList.contains('hidden'));
          const sizes = cols.map((el) => { const r = el.getBoundingClientRect(); return vertical ? r.height : r.width; });
          const total = sizes.reduce((a, b) => a + b, 0) || 1;
          cols.forEach((el, i) => { el.style.flex = `${sizes[i] / total} 1 0`; });
          const before = (el) => !!(handle.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
          const ia = cols.filter(before).length - 1;
          return { vertical, cols, sizes, total, ia, ib: ia + 1 };
        },
        move: (s, dx, dy) => {
          const { cols, sizes, total, ia, ib } = s;
          if (ia < 0 || ib >= cols.length) return;
          const pair = sizes[ia] + sizes[ib];
          const min = Math.min(pair / 2, Math.max(100, total * 0.1));
          const a = Math.max(min, Math.min(pair - min, sizes[ia] + (s.vertical ? dy : dx)));
          cols[ia].style.flex = `${a / total} 1 0`;
          cols[ib].style.flex = `${(pair - a) / total} 1 0`;
        },
      });
    }
  }
}

function drag(handle, { start, move, end }) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const s0 = start(handle);
    const x0 = e.clientX, y0 = e.clientY;
    const onMove = (ev) => move(s0, ev.clientX - x0, ev.clientY - y0);
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      end && end(s0);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}
