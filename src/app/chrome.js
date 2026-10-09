// app/chrome.js — rendering of the per-pane chrome (tab bar, breadcrumbs,
// conflict bar, empty-pane welcome) and the status bar.

import { h, icon, onLongPress } from '../ui/dom.js';
import { popupMenu } from '../ui/overlays.js';
import { dirname } from '../core/paths.js';
import { eolLabel } from '../core/textFormat.js';
import { symbolPathAt } from '../editor/outline.js';
import { symbolsFor } from '../editor/viewPlugins.js';
import { fileBadge } from '../ui/fileTree.js';

export function renderTabBar(app, paneIndex) {
  const ws = app.ws;
  const pane = ws.panes[paneIndex];
  const bar = document.querySelector(`#pane-${paneIndex} .tab-bar`);
  if (!pane || !bar) return;
  // Rebuild only when something shown changed. Rebuilding on every focus
  // change replaced the ✕ under the finger between touch-down and touch-up,
  // so the first tap on a tab in the other pane did nothing.
  const sig = JSON.stringify([pane.tabs, pane.activeId, paneIndex === 1 && ws.isSplit(),
    pane.tabs.map((id) => { const d = ws.docs.get(id); return d ? [d.name, d.path, d.dirty, d.locked, d.kind] : null; })]);
  if (bar._sig === sig && bar.childElementCount) return;
  bar._sig = sig;
  bar.textContent = '';
  const names = new Map();
  for (const id of pane.tabs) { const d = ws.docs.get(id); if (d) names.set(d.name, (names.get(d.name) || 0) + 1); }
  for (const id of pane.tabs) {
    const doc = ws.docs.get(id);
    if (!doc) continue;
    const active = id === pane.activeId;
    // Same file name twice (two index.js)? Show the folder to tell them apart.
    const showDir = names.get(doc.name) > 1 && doc.path;
    const tab = h('div.tab', {
      role: 'tab', tabindex: '0', 'aria-selected': String(active),
      class: `${active ? 'active' : ''} ${doc.dirty ? 'dirty' : ''} ${doc.kind === 'untitled' ? 'untitled' : ''}`,
      title: doc.path || doc.name, dataset: { docId: id },
      onclick: (e) => { if (!e.target.closest('.tab-close')) ws.showDoc(paneIndex, id); },
      onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); ws.closeTab(paneIndex, id); } },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ws.showDoc(paneIndex, id); } },
    },
    fileBadge(doc.name),
    h('span.tab-name', doc.name),
    showDir ? h('span.tab-dir', dirname(doc.path)) : null,
    doc.locked ? h('span', { html: icon('lock', 12), title: 'Read-only' }) : null,
    h('span.tab-close', { role: 'button', 'aria-label': `Close ${doc.name}`, html: icon('close', 14), onclick: (e) => { e.stopPropagation(); ws.closeTab(paneIndex, id); } }));
    bar.append(tab);
    if (active) requestAnimationFrame(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
  // The split can always be closed from the second pane (the titlebar's split
  // button is hidden on narrow screens).
  if (paneIndex === 1 && ws.isSplit()) {
    bar.append(h('button.split-close', { type: 'button', title: 'Close the split view (its tabs move to the first pane)', 'aria-label': 'Close split view', onclick: () => app.toggleSplit() },
      h('span', { html: icon('close', 13) }), 'Split'));
  }
  if (!bar._menuBound) {
    bar._menuBound = true;
    onLongPress(bar, '.tab', (tab, at) => tabMenu(app, paneIndex, Number(tab.dataset.docId), at));
  }
}

function tabMenu(app, paneIndex, docId, at) {
  const ws = app.ws;
  const doc = ws.docs.get(docId);
  const pane = ws.panes[paneIndex];
  if (!doc || !pane) return;
  const other = paneIndex === 0 ? 1 : 0;
  popupMenu([
    { label: 'Close', icon: 'close', run: () => ws.closeTab(paneIndex, docId) },
    { label: 'Close others', run: () => ws.closeOthers(paneIndex, docId) },
    { label: 'Close tabs to the right', run: async () => { for (const id of pane.tabs.slice(pane.tabs.indexOf(docId) + 1)) if (!(await ws.closeTab(paneIndex, id))) break; } },
    { label: 'Close saved', run: async () => { for (const id of [...pane.tabs]) if (!ws.docs.get(id)?.dirty) await ws.closeTab(paneIndex, id); } },
    '-',
    { label: paneIndex === 0 ? (app.layout.compact ? 'Open in split view (below)' : 'Open in right pane') : (app.layout.compact ? 'Move to the upper pane' : 'Move to left pane'), icon: 'split', run: () => app.openInPane(doc, other, paneIndex === 1) },
    doc.path && { label: 'Reveal in file tree', icon: 'files', run: () => app.revealInTree(doc.path) },
    doc.path && { label: 'Copy path', icon: 'copy', run: () => app.copyText(doc.path) },
    { label: doc.locked ? 'Unlock editing' : 'Lock (read-only)', icon: doc.locked ? 'unlock' : 'lock', run: () => ws.setLocked(docId, !doc.locked) },
  ].filter(Boolean), at);
}

export function renderCrumbs(app, paneIndex) {
  const ws = app.ws;
  const pane = ws.panes[paneIndex];
  const el = document.querySelector(`#pane-${paneIndex} .crumbs`);
  if (!pane || !el) return;
  el.textContent = '';
  const doc = pane.activeId != null ? ws.docs.get(pane.activeId) : null;
  document.getElementById(`pane-${paneIndex}`).classList.toggle('empty', !doc);
  if (!doc) return;
  const parts = (doc.path || doc.name).split('/');
  parts.forEach((p, i) => {
    if (i) el.append(h('span.crumb-sep', '›'));
    const sub = parts.slice(0, i + 1).join('/');
    el.append(h('button.crumb', { type: 'button', onclick: () => (doc.path ? app.revealInTree(sub) : null) }, p));
  });
  const state = pane.view.state;
  if (doc.lang.lezer) {
    const path = symbolPathAt(symbolsFor(state), state.selection.main.head);
    for (const s of path) {
      el.append(h('span.crumb-sep', '›'));
      el.append(h('button.crumb.symbol', { type: 'button', onclick: () => app.showPanel('outline') }, s.name));
    }
  }
}

export function renderConflict(app, paneIndex) {
  const ws = app.ws;
  const pane = ws.panes[paneIndex];
  const el = document.querySelector(`#pane-${paneIndex} .conflict-bar`);
  if (!pane || !el) return;
  const doc = pane.activeId != null ? ws.docs.get(pane.activeId) : null;
  el.textContent = '';
  if (!doc || !doc.conflict) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const msg = doc.conflict.reason === 'recovered'
    ? 'Restored unsaved changes, but the file on disk also changed since.'
    : 'This file changed on disk while you have unsaved edits.';
  el.append(
    h('span.msg', msg),
    h('button.btn.btn-small', { type: 'button', onclick: () => app.compareWithDisk(doc) }, 'Compare'),
    h('button.btn.btn-small', { type: 'button', onclick: () => ws.resolveConflict(doc.id, 'disk') }, 'Use disk version'),
    h('button.btn.btn-small.btn-primary', { type: 'button', onclick: () => ws.resolveConflict(doc.id, 'mine') }, 'Keep mine'),
  );
}

/**
 * The status bar updates its items IN PLACE (keyed), never by clearing and
 * rebuilding: it re-renders on every cursor move, and a DOM node replaced
 * while a finger is on it stops receiving that touch — the status-bar swipe
 * (switch tabs) would randomly fail.
 */
export function renderStatus(app) {
  const ws = app.ws;
  const items = [];
  const add = (key, content, opts = {}) => items.push({ key, content, ...opts });
  if (app.gitBranch) add('branch', [h('span', { html: icon('branch', 14) }), app.gitBranch], { title: 'Git branch', menu: `Git branch: ${app.gitBranch}`, onclick: () => app.showPanel('git') });
  const { errors, warnings } = app.problemCounts || { errors: 0, warnings: 0 };
  add('problems', `✖ ${errors}  ⚠ ${warnings}`, { cls: errors ? 'err' : warnings ? 'warn' : '', title: 'Problems', onclick: () => app.bottom.toggle('problems') });
  add('spacer', null, { spacer: true });
  const doc = ws.activeDoc;
  if (!doc) {
    add('project', app.project ? app.project.meta.name : 'No project');
  } else {
    const state = ws.view.state;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const selLen = state.selection.ranges.reduce((n, r) => n + r.to - r.from, 0);
    const locked = doc.locked || !!doc.readOnlyReason;
    const pos = `Ln ${line.number}, Col ${head - line.from + 1}`;
    add('pos', `${pos}${selLen ? ` (${selLen} sel)` : ''}${state.selection.ranges.length > 1 ? ` · ${state.selection.ranges.length} cursors` : ''}`, { title: 'Go to line', menu: `Go to line… (${pos})`, onclick: () => app.palette.open(':') });
    const indent = doc.indent.insertSpaces ? `Spaces: ${doc.indent.indentSize}` : `Tabs: ${doc.indent.tabWidth}`;
    add('indent', indent, { title: `Indentation (from ${doc.indentSource})`, menu: `Indentation: ${indent}…`, onclick: (e) => indentMenu(app, doc, e) });
    add('eol', eolLabel(doc.format.eol), { title: 'Line endings (kept as in the file)', menu: `Line endings: ${eolLabel(doc.format.eol)}…`, onclick: (e) => eolMenu(app, doc, e) });
    const enc = doc.format.encoding === 'unknown' ? 'Unknown encoding' : `${doc.format.encoding.toUpperCase()}${doc.format.bom ? ' BOM' : ''}`;
    add('enc', enc, { title: 'Encoding', menu: `Encoding: ${enc}` });
    add('lang', doc.lang.name, { title: 'Language mode', menu: `Language: ${doc.lang.name}…`, onclick: () => app.pickLanguage() });
    // On a phone the wrap toggle is just its icon (it is coloured when on).
    add('wrap', app.layout && app.layout.compact ? h('span', { html: icon('wrap', 14) }) : [h('span', { html: icon('wrap', 14) }), 'Wrap'], {
      cls: doc.wrap ? 'on' : '', title: 'Toggle soft wrap', label: `Soft wrap ${doc.wrap ? 'on' : 'off'}`,
      menu: `Soft wrap: ${doc.wrap ? 'on' : 'off'}`, onclick: () => ws.setWrap(doc.id, !doc.wrap),
    });
    add('lock', h('span', { html: icon(locked ? 'lock' : 'unlock', 14) }), {
      menu: doc.readOnlyReason ? 'Read-only file' : doc.locked ? 'Unlock editing' : 'Lock editing',
      cls: locked ? 'on' : '', title: doc.readOnlyReason || (doc.locked ? 'Read-only (tap to unlock)' : 'Lock to prevent accidental edits'),
      label: doc.locked ? 'Unlock editing' : 'Lock editing',
      onclick: () => (doc.readOnlyReason ? app.toast(doc.readOnlyReason, 'warn') : ws.setLocked(doc.id, !doc.locked)),
    });
  }
  // Always last; shown only when some items had to make room (see fitStatus).
  add('more', '⋯', { title: 'More', label: 'More status items', onclick: (e) => overflowMenu(e, items) });
  const bar = document.getElementById('statusbar');
  reconcile(bar, items);
  if (!bar._fitQueued) {
    bar._fitQueued = true;
    requestAnimationFrame(() => { bar._fitQueued = false; fitStatus(bar); });
  }
}

/** Least needed first: these move into the ⋯ menu when the bar is too narrow. */
const OVERFLOW_ORDER = ['enc', 'eol', 'indent', 'lang', 'branch', 'wrap', 'lock', 'pos'];

/** One line, never scrolling: hide items (into ⋯) until the rest fits. */
function fitStatus(bar) {
  const more = bar.querySelector('[data-key="more"]');
  if (!more) return;
  for (const el of bar.children) el.classList.remove('sb-overflowed');
  more.classList.add('sb-overflowed');
  const fits = () => bar.scrollWidth <= bar.clientWidth + 1;
  if (fits()) return;
  more.classList.remove('sb-overflowed');
  for (const key of OVERFLOW_ORDER) {
    const el = bar.querySelector(`[data-key="${key}"]`);
    if (!el) continue;
    el.classList.add('sb-overflowed');
    if (fits()) break;
  }
}

function overflowMenu(e, items) {
  const bar = document.getElementById('statusbar');
  const hidden = new Set([...bar.querySelectorAll('.sb-overflowed')].map((el) => el.dataset.key));
  const btn = e.currentTarget;
  const r = btn.getBoundingClientRect();
  popupMenu(items.filter((it) => hidden.has(it.key) && it.menu).map((it) => ({
    label: it.menu,
    disabled: !it.onclick,
    run: () => it.onclick && it.onclick({ currentTarget: btn }),
  })), { x: r.left, y: r.top - 8 });
}

function reconcile(bar, items) {
  const existing = new Map([...bar.children].map((el) => [el.dataset.key, el]));
  const wanted = new Set(items.map((i) => i.key));
  for (const [key, el] of existing) if (!wanted.has(key)) el.remove();
  let prev = null;
  for (const it of items) {
    const tag = it.spacer ? 'span' : it.onclick ? 'button' : 'span';
    let el = existing.get(it.key);
    if (!el || el.tagName.toLowerCase() !== tag) {
      if (el) el.remove();
      el = document.createElement(tag);
      el.dataset.key = it.key;
      if (tag === 'button') el.type = 'button';
    }
    el.className = it.spacer ? 'spacer' : `sb-item ${it.cls || ''}`.trim();
    if (it.title) el.title = it.title; else el.removeAttribute('title');
    if (it.label) el.setAttribute('aria-label', it.label); else el.removeAttribute('aria-label');
    el.onclick = it.onclick || null;
    // Only touch the content when it actually changed.
    const sig = Array.isArray(it.content) || it.content instanceof Node
      ? [].concat(it.content).map((c) => (c instanceof Node ? c.outerHTML : String(c))).join('')
      : String(it.content ?? '');
    if (el._sig !== sig) {
      el._sig = sig;
      el.textContent = '';
      for (const c of [].concat(it.content ?? [])) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    const after = prev ? prev.nextSibling : bar.firstChild;
    if (after !== el) bar.insertBefore(el, after);
    prev = el;
  }
}

function indentMenu(app, doc, e) {
  const r = e.currentTarget.getBoundingClientRect();
  const set = (insertSpaces, size) => app.ws.setIndent(doc.id, { insertSpaces, indentSize: size, tabWidth: size });
  popupMenu([
    { label: 'Spaces: 2', run: () => set(true, 2) },
    { label: 'Spaces: 4', run: () => set(true, 4) },
    { label: 'Tabs (width 4)', run: () => set(false, 4) },
    { label: 'Tabs (width 8)', run: () => set(false, 8) },
    '-',
    { label: 'Reindent whole file', run: () => app.run('reindent') },
  ], { x: r.left, y: r.top - 8 });
}

function eolMenu(app, doc, e) {
  const r = e.currentTarget.getBoundingClientRect();
  popupMenu([
    { label: 'LF (Linux, macOS, Android)', run: () => app.ws.setEol(doc.id, '\n') },
    { label: 'CRLF (Windows)', run: () => app.ws.setEol(doc.id, '\r\n') },
  ], { x: r.left, y: r.top - 8 });
}

export function renderWelcome(app, paneIndex) {
  const el = document.querySelector(`#pane-${paneIndex} .pane-empty`);
  if (!el) return;
  el.textContent = '';
  if (paneIndex === 1) { el.append(h('div.welcome', h('p.sub', 'Open a file here from the file tree (long-press → Open to the side) or move a tab with long-press.'))); return; }
  if (!app.project) { el.append(app.projectPickerView()); return; }
  const card = (iconName, title, desc, run) => h('button.action-card', { type: 'button', onclick: run }, h('span', { html: icon(iconName, 22) }), h('span.ac-text', h('span.ac-title', title), h('span.ac-desc', desc)));
  const recent = (app.recentFiles || []).slice(0, 6);
  el.append(h('div.welcome',
    h('h1', app.project.meta.name),
    h('p.sub', 'Pick a file from the sidebar, or:'),
    h('div.action-grid',
      card('search', 'Quick open', 'Find a file by name (Ctrl+P)', () => app.palette.open('')),
      card('newFile', 'New file', 'Create a file in the project', () => app.actions.newFile('')),
      card('files', 'Browse files', 'Show the project tree', () => app.showPanel('files')),
      card('command', 'All commands', 'Ctrl+Shift+P · two-finger tap', () => app.palette.open('>'))),
    recent.length ? h('h3', 'Recent files') : null,
    recent.length ? h('div.project-list', recent.map((p) => h('div.project-row', h('button.pr-main', { type: 'button', onclick: () => app.ws.openPath(p) }, h('span.pr-name', p.split('/').pop()), h('span.pr-meta', p))))) : null,
    h('h3', 'Coding on a touch screen'),
    gestureCheatSheet(app),
  ));
}

export function gestureCheatSheet(app) {
  const s = app.settings;
  const rows = [
    ['Swipe → (1 finger)', s.gestureMap['swipe-right-1']],
    ['Swipe ← (1 finger)', s.gestureMap['swipe-left-1']],
    ['Swipe ← / → (2 fingers)', `${s.gestureMap['swipe-left-2']} / ${s.gestureMap['swipe-right-2']}`],
    ['Swipe ↓ (2 fingers)', s.gestureMap['swipe-down-2']],
    ['Tap (2 fingers)', s.gestureMap['tap-2']],
    ['Pinch', 'zoom the code'],
    ['Tap / drag line numbers', 'select lines'],
    ['Keys bar: swipe up on a key', 'type its corner symbol'],
    ['Keys bar: drag the trackpad', 'move the cursor'],
    ['Status bar: swipe ← / →', 'switch tabs'],
    ['Long-press a tab or file', 'more actions'],
  ];
  const label = (a) => ({ autocomplete: 'autocomplete', dismissOrDeleteWord: 'close list / delete word', commandPalette: 'command palette', hideKeyboard: 'hide keyboard', none: '—' }[a] || a);
  return h('table.help-table', h('tbody', rows.map(([g, a]) => h('tr', h('td', g), h('td', label(a))))));
}
