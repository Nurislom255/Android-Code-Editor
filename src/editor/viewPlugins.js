// editor/viewPlugins.js — small editor add-ons built as CodeMirror ViewPlugins:
//
//   wrapIndent   soft-wrapped rows line up under their line's indentation (spec §2)
//   stickyScroll the enclosing function/class header stays pinned at the top
//   fastScroll   a draggable thumb for long files (spec §3.3) — phone
//                scrollbars are too thin to grab with a finger
//
// A ViewPlugin is CodeMirror's hook for "code that lives as long as the view
// and reacts to every update", similar to a React component's effect.

import { ViewPlugin, Decoration, EditorView } from '@codemirror/view';
import { RangeSetBuilder, countColumn } from '@codemirror/state';
import { syntaxTreeAvailable } from '@codemirror/language';
import { getSymbols, stickySymbolsAt } from './outline.js';

// ---- wrapIndent ------------------------------------------------------------

const MAX_HANG = 24;

function buildWrapIndent(view) {
  if (!view.lineWrapping) return Decoration.none;
  const builder = new RangeSetBuilder();
  const tabSize = view.state.tabSize;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const ws = /^[ \t]*/.exec(line.text)[0];
      if (ws.length && ws.length < line.text.length) {
        const cols = Math.min(countColumn(ws, tabSize), MAX_HANG);
        builder.add(line.from, line.from, Decoration.line({
          attributes: { style: `text-indent:-${cols}ch;padding-left:calc(${cols}ch + 6px)` },
        }));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const wrapIndent = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildWrapIndent(view); this.wrap = view.lineWrapping; }
  update(u) {
    if (u.docChanged || u.viewportChanged || this.wrap !== u.view.lineWrapping || u.startState.tabSize !== u.state.tabSize) {
      this.wrap = u.view.lineWrapping;
      this.decorations = buildWrapIndent(u.view);
    }
  }
}, { decorations: (v) => v.decorations });

// ---- symbols cache shared by sticky scroll, outline and breadcrumbs ----------

const symbolCache = new WeakMap(); // Text -> symbols

export function symbolsFor(state) {
  const hit = symbolCache.get(state.doc);
  if (hit) return hit;
  const syms = getSymbols(state, { timeout: 25 });
  if (syntaxTreeAvailable(state, state.doc.length)) symbolCache.set(state.doc, syms);
  return syms;
}

// ---- stickyScroll ------------------------------------------------------------

const MAX_STICKY = 3;

export const stickyScroll = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.dom = document.createElement('div');
    this.dom.className = 'cm-sticky';
    this.dom.setAttribute('aria-hidden', 'true');
    view.dom.appendChild(this.dom);
    this.onScroll = () => this.schedule();
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    this.dom.addEventListener('click', (e) => {
      const row = e.target.closest('[data-pos]');
      if (!row) return;
      const pos = Number(row.dataset.pos);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 4 }) });
      view.focus();
    });
    this.key = '';
    this.schedule();
  }

  update(u) {
    if (u.docChanged || u.geometryChanged || u.viewportChanged) this.schedule();
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  render() {
    const { view } = this;
    const scroller = view.scrollDOM;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const atHeight = (h) => view.state.doc.lineAt(view.lineBlockAtHeight(h).from).number;
    const top = scrollerTop - view.documentTop;
    let list = [];
    if (top > 0) {
      const symbols = symbolsFor(view.state);
      // Two passes: the pinned rows themselves cover lines, so look below them.
      list = stickySymbolsAt(symbols, atHeight(top), view.state.doc).slice(0, MAX_STICKY);
      if (list.length) list = stickySymbolsAt(symbols, atHeight(top + list.length * view.defaultLineHeight), view.state.doc).slice(0, MAX_STICKY);
    }
    const key = list.map((s) => s.from).join(',') + '|' + view.contentDOM.offsetLeft;
    if (key === this.key) return;
    this.key = key;
    this.dom.textContent = '';
    this.dom.style.display = list.length ? '' : 'none';
    if (!list.length) return;
    const gutterWidth = view.contentDOM.getBoundingClientRect().left - view.dom.getBoundingClientRect().left;
    this.dom.style.top = `${scroller.offsetTop}px`;
    this.dom.style.left = '0px';
    for (const sym of list) {
      const row = document.createElement('div');
      row.className = 'cm-sticky-row';
      row.dataset.pos = String(sym.from);
      const num = document.createElement('span');
      num.className = 'cm-sticky-num';
      num.style.width = `${gutterWidth}px`;
      num.textContent = String(sym.line);
      const text = document.createElement('span');
      text.className = 'cm-sticky-text';
      text.textContent = view.state.doc.line(sym.line).text;
      row.append(num, text);
      this.dom.appendChild(row);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.dom.remove();
  }
});

// ---- fastScroll -----------------------------------------------------------

const THUMB_H = 44;

export const fastScroll = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.thumb = document.createElement('div');
    this.thumb.className = 'cm-fastscroll';
    this.thumb.setAttribute('role', 'scrollbar');
    this.thumb.setAttribute('aria-label', 'Fast scroll');
    this.thumb.setAttribute('aria-orientation', 'vertical');
    view.dom.appendChild(this.thumb);
    this.onScroll = () => this.show();
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });

    this.thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.thumb.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.thumb.classList.add('dragging');
      const startY = e.clientY;
      const startTop = view.scrollDOM.scrollTop;
      const move = (ev) => {
        const s = view.scrollDOM;
        const track = s.clientHeight - THUMB_H;
        const max = s.scrollHeight - s.clientHeight;
        s.scrollTop = startTop + ((ev.clientY - startY) / Math.max(1, track)) * max;
      };
      const up = () => {
        this.dragging = false;
        this.thumb.classList.remove('dragging');
        this.thumb.removeEventListener('pointermove', move);
        this.show();
      };
      this.thumb.addEventListener('pointermove', move);
      this.thumb.addEventListener('pointerup', up, { once: true });
      this.thumb.addEventListener('pointercancel', up, { once: true });
    });
  }

  show() {
    const s = this.view.scrollDOM;
    const long = s.scrollHeight > s.clientHeight * 3;
    if (!long) { this.thumb.classList.remove('visible'); return; }
    const max = s.scrollHeight - s.clientHeight;
    const track = s.clientHeight - THUMB_H;
    this.thumb.style.top = `${s.offsetTop + (s.scrollTop / Math.max(1, max)) * track}px`;
    this.thumb.classList.add('visible');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { if (!this.dragging) this.thumb.classList.remove('visible'); }, 1400);
  }

  destroy() {
    clearTimeout(this.hideTimer);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.thumb.remove();
  }
});
