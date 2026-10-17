// ui/fileTree.js — the project file tree (VS Code's explorer, for touch).
//
// Folders load their children only when expanded (one directory listing per
// expand), so opening a project with a huge node_modules costs nothing.
//
//   tap            a file: open it (as a preview tab; double-tap keeps it).
//                  A folder: open / close it. Either way the row is selected,
//                  and New File / New Folder go into the selected folder (or
//                  the selected file's folder).
//   long-press     the menu (rename, cut / copy / paste, select…); keep
//                  moving after it to drag the entry (or the selection):
//                  between two rows it stays there (each folder remembers
//                  its own order; folders stay above files), onto the middle
//                  of a folder it goes inside. Hovering over a closed folder
//                  opens it.
//   Select         (menu) taps then add / remove rows; a bar acts on them.
//   mouse          Ctrl/⌘-click adds to the selection, Shift-click a range.
//   keyboard       F2 rename, Delete, Ctrl+C / X / V, Enter, Esc.
//
// Creating and renaming happen in the tree itself, in an editable row.

import { h, icon } from './dom.js';
import { fileIcon, folderIcon } from './fileTypeIcons.js';
import { popupMenu } from './overlays.js';
import { dragMove } from './dragMove.js';
import { dirname, basename, join } from '../core/paths.js';
import { rangeBetween, filterPaths, canMoveInto, orderEntries } from '../core/explorer.js';

const HOVER_OPEN_MS = 600; // dragging over a closed folder this long opens it
const DOUBLE_TAP_MS = 450;

const depthOf = (row) => Number(row.style.getPropertyValue('--depth')) || 0;
/** The entry a row stands for in its folder: a compact "a/b/c" row is "a". */
const entryOf = (row) => row.dataset.top || row.dataset.path;

export class FileTree {
  /**
   * @param {HTMLElement} container
   * @param {object} deps {getFs, isHidden(name), onOpen(path, {keep}), onKeep(path), onExpandChange(list),
   *   getGitBadges():Map, getOpenState():{active, dirty:Set}, getSettings(), listAll():Promise<string[]>,
   *   getOrder(dir):string[]|null (the folder's custom order),
   *   actions:{newFile, newFolder, rename, remove, removeMany, move, moveMany, place, sortAZ, cut, copy, paste, canPaste, …}}
   */
  constructor(container, deps) {
    this.el = container;
    this.deps = deps;
    this.expanded = new Set();
    this.cache = new Map();    // dir -> entries
    this.rows = new Map();     // path -> row element
    this.alias = new Map();    // a folder hidden inside a compact row -> that row
    this.selected = new Set(); // selected paths
    this.focus = null;         // the last row tapped: where new files go
    this.multi = false;        // touch selection mode (taps add / remove)
    this.filter = '';
    this.lastTap = null;
    this.afterDrag = []; // renders waiting for a drag to end
    this.el.classList.add('tree');
    this.el.setAttribute('role', 'tree');
    this.el.tabIndex = -1;
    this.bar = h('div.tree-selbar.hidden', { role: 'toolbar', 'aria-label': 'Selected files' });
    this.rowsEl = h('div.tree-rows');
    this.el.append(this.bar, this.rowsEl);
    dragMove(this.el, '.tree-row:not(.tree-edit)', {
      axis: 'y',
      lockAxis: true,
      getSettings: deps.getSettings,
      menu: (row, at) => this.menu(row.dataset.path, row.dataset.kind, at),
      badge: (row) => this.dragged(row).length,
      find: (row, el, x, y) => this.dropTarget(row, el, x, y),
      drop: (row, t) => {
        const paths = this.dragged(row);
        const a = deps.actions;
        this.dropped = true;
        if (t.slot) a.place(paths, t.dir, t.before);
        else if (paths.length > 1) a.moveMany(paths, t.dir);
        else a.move(paths[0], row.dataset.kind, t.dir);
      },
      onDragChange: (on, row) => this.dragChange(on, row),
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
  }

  // ---- data ---------------------------------------------------------------------------

  async reset(expanded = []) {
    this.cache.clear();
    this.expanded = new Set(expanded);
    this.selected.clear();
    this.focus = null;
    this.multi = false;
    await this.render();
  }

  async list(dir) {
    if (!this.cache.has(dir)) {
      const fs = this.deps.getFs();
      let entries = [];
      try { entries = fs ? await fs.list(dir) : []; } catch { entries = []; }
      this.cache.set(dir, entries);
    }
    const order = this.deps.getOrder ? this.deps.getOrder(dir) : null;
    return orderEntries(this.cache.get(dir), order).filter((e) => !this.deps.isHidden(e.name));
  }

  /** Re-reads the given folders (or all expanded ones) from storage. */
  async refresh(dirs = null) {
    if (dirs) for (const d of dirs) this.cache.delete(d);
    else this.cache.clear();
    await this.render();
  }

  get compact() { const s = this.deps.getSettings && this.deps.getSettings(); return !s || s.compactFolders !== false; }

  /** Where New File / New Folder / Paste go: the selected folder, or the selected file's folder. */
  targetDir() {
    if (this.focus == null) return '';
    const row = this.rowFor(this.focus);
    if (!row) return '';
    return row.dataset.kind === 'directory' ? row.dataset.path : dirname(row.dataset.path);
  }

  rowFor(path) { return this.rows.get(path) || this.alias.get(path) || null; }

  /** Paths in the order shown. */
  order() { return [...this.rowsEl.querySelectorAll('.tree-row[data-path]')].map((r) => r.dataset.path); }

  // ---- drawing --------------------------------------------------------------------------

  async render() {
    // Not under a dragging finger: the drag would lose its row. After it.
    if (this.dragging) await new Promise((resolve) => this.afterDrag.push(resolve));
    const fs = this.deps.getFs();
    const frag = document.createDocumentFragment();
    this.rows.clear();
    this.alias.clear();
    if (fs && this.filter) await this.renderFiltered(frag);
    else if (fs) await this.renderDir('', 0, frag);
    this.rowsEl.textContent = '';
    this.rowsEl.append(frag);
    if (fs && !this.rowsEl.children.length) {
      this.rowsEl.append(h('div.panel-note', this.filter ? `No file matches “${this.filter}”.` : ['This project is empty. Create a file with the ', h('b', '+'), ' button above.']));
    }
    this.decorate();
  }

  async renderDir(dir, depth, into) {
    for (const e of await this.list(dir)) {
      if (e.kind !== 'directory') { into.append(this.fileRow(e.path, depth)); continue; }
      // Compact folders: a folder holding only one folder is one row, "a/b/c".
      const chain = [e];
      if (this.compact) {
        for (;;) {
          const kids = await this.list(chain[chain.length - 1].path);
          if (kids.length === 1 && kids[0].kind === 'directory') chain.push(kids[0]); else break;
        }
      }
      const deep = chain[chain.length - 1];
      const open = this.expanded.has(deep.path);
      const row = this.dirRow(chain, depth, open);
      into.append(row);
      for (const c of chain.slice(0, -1)) this.alias.set(c.path, row);
      if (open) await this.renderDir(deep.path, depth + 1, into);
    }
  }

  fileRow(path, depth, { showDir = false } = {}) {
    const row = h('button.tree-row.file', {
      type: 'button', role: 'treeitem', style: { '--depth': depth }, dataset: { path, kind: 'file' }, title: path,
      onclick: (ev) => this.tap(path, 'file', ev),
    },
    h('span.twisty'),
    fileIcon(basename(path)),
    h('span.tname', basename(path)),
    showDir && dirname(path) ? h('span.tdir', dirname(path)) : null,
    h('span.tbadge'));
    this.rows.set(path, row);
    return row;
  }

  dirRow(chain, depth, open) {
    const deep = chain[chain.length - 1];
    const label = chain.length === 1 ? deep.name
      : chain.flatMap((c, i) => [i ? h('span.tsep', '/') : null, h('span.tseg', { dataset: { seg: c.path } }, c.name)]);
    const row = h('button.tree-row.dir', {
      type: 'button', role: 'treeitem', 'aria-expanded': String(open), class: open ? 'open' : '',
      style: { '--depth': depth }, dataset: { path: deep.path, kind: 'directory', ...(chain.length > 1 ? { top: chain[0].path } : {}) }, title: deep.path,
      onclick: (ev) => this.tap(deep.path, 'directory', ev),
    },
    h('span.twisty', { html: icon('chevronRight', 14) }),
    folderIcon(deep.name, open),
    h('span.tname', label),
    h('span.tbadge'));
    this.rows.set(deep.path, row);
    return row;
  }

  /** The filter box: matching files as a flat list (from the whole project). */
  async renderFiltered(into) {
    const all = this.deps.listAll ? await this.deps.listAll() : [];
    for (const p of filterPaths(all, this.filter)) into.append(this.fileRow(p, 0, { showDir: true }));
  }

  async setFilter(text) {
    this.filter = text.trim();
    await this.render();
  }

  // ---- taps & selection -------------------------------------------------------------------

  async tap(path, kind, ev = {}) {
    if (this.editing) return;
    const add = ev.ctrlKey || ev.metaKey;
    if (ev.shiftKey && this.focus) {
      this.selected = new Set(rangeBetween(this.order(), this.focus, path));
      this.paintSelection();
      return;
    }
    if (add || this.multi) {
      if (this.selected.has(path)) this.selected.delete(path); else this.selected.add(path);
      this.focus = path;
      if (this.multi && !this.selected.size) this.multi = false;
      this.paintSelection();
      return;
    }
    this.selected = new Set([path]);
    this.focus = path;
    this.paintSelection();
    if (kind === 'directory') {
      await this.toggle(path);
      return;
    }
    const now = Date.now();
    const again = this.lastTap && this.lastTap.path === path && now - this.lastTap.t < DOUBLE_TAP_MS;
    this.lastTap = { path, t: now };
    if (again) this.deps.onKeep && this.deps.onKeep(path);
    else this.deps.onOpen(path, {});
  }

  async toggle(dir) {
    if (this.expanded.has(dir)) this.expanded.delete(dir);
    else this.expanded.add(dir);
    this.saveExpanded();
    await this.render();
  }

  saveExpanded() { this.deps.onExpandChange && this.deps.onExpandChange([...this.expanded]); }

  /** Touch selection mode: taps add or remove rows until it is left. */
  startSelecting(path) {
    this.multi = true;
    this.selected = new Set(path ? [path] : []);
    this.focus = path;
    this.paintSelection();
  }

  clearSelection() {
    this.multi = false;
    this.selected.clear();
    this.paintSelection();
  }

  paintSelection() {
    for (const [path, row] of this.rows) row.classList.toggle('selected', this.selected.has(path));
    const many = this.multi || this.selected.size > 1;
    this.bar.classList.toggle('hidden', !many);
    this.el.classList.toggle('selecting', this.multi);
    if (!many) return;
    const a = this.deps.actions;
    const paths = [...this.selected];
    const btn = (label, iconName, run, extra = {}) => h('button.btn.btn-small', { type: 'button', onclick: run, ...extra }, h('span', { html: icon(iconName, 14) }), label);
    this.bar.textContent = '';
    this.bar.append(
      h('span.tree-selcount', `${paths.length} selected`),
      btn('Cut', 'edit', () => { a.cut(paths); this.clearSelection(); }, { disabled: !paths.length }),
      btn('Copy', 'copy', () => { a.copy(paths); this.clearSelection(); }, { disabled: !paths.length }),
      btn('Delete', 'trash', () => { a.removeMany(paths); this.clearSelection(); }, { disabled: !paths.length }),
      h('button.icon-btn.small', { type: 'button', 'aria-label': 'Stop selecting', title: 'Stop selecting', html: icon('close', 16), onclick: () => this.clearSelection() }));
  }

  /** What a drag moves: the selection if the row is part of it, else the row. A compact "a/b/c" row moves "a". */
  dragged(row) {
    const p = row.dataset.path;
    const paths = this.selected.has(p) && this.selected.size > 1 ? [...this.selected] : [p];
    return paths.map((x) => { const r = this.rows.get(x); return r ? entryOf(r) : x; });
  }

  // ---- reveal, collapse ---------------------------------------------------------------------

  /** Expands parents and scrolls the file into view. `flash`: outline it for a moment. */
  async reveal(path, { flash = true } = {}) {
    if (this.filter) return;
    const parts = path.split('/');
    let changed = false;
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!this.expanded.has(dir)) { this.expanded.add(dir); changed = true; }
    }
    if (changed) { this.saveExpanded(); await this.render(); }
    const row = this.rowFor(path);
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
      if (flash) {
        row.classList.add('focused');
        setTimeout(() => row.classList.remove('focused'), 1200);
      }
    }
  }

  collapseAll() {
    this.expanded.clear();
    this.saveExpanded();
    this.render();
  }

  /** Marks the active file, unsaved files and git status letters. */
  decorate() {
    const { active, dirty } = this.deps.getOpenState();
    const badges = this.deps.getGitBadges ? this.deps.getGitBadges() : new Map();
    // Folders holding changes are tinted too, as in VS Code.
    const changedDirs = new Set();
    for (const p of badges.keys()) for (let i = p.lastIndexOf('/'); i > 0; i = p.lastIndexOf('/', i - 1)) changedDirs.add(p.slice(0, i));
    for (const [path, row] of this.rows) {
      row.classList.toggle('active', path === active);
      row.classList.toggle('dirty', dirty.has(path));
      row.classList.toggle('selected', this.selected.has(path));
      row.classList.toggle('cut', !!(this.deps.actions.isCut && this.deps.actions.isCut(path)));
      const b = row.querySelector('.tbadge');
      const letter = badges.get(path) || '';
      b.textContent = letter;
      b.className = `tbadge ${letter}`;
      row.dataset.git = letter || (row.dataset.kind === 'directory' && changedDirs.has(path) ? 'dir' : '');
    }
  }

  // ---- drag and drop --------------------------------------------------------------------

  /**
   * Where a dragged entry would go, from where the finger is on a row:
   *   a file row         upper half → before it, lower half → after it
   *   a folder row       upper quarter → before it, lower quarter → after
   *                      it (an open folder: its first entry), the middle →
   *                      into it (held there, a closed folder opens)
   *   below the rows     the end of the project root
   * "Before / after" is a slot: the entry keeps that place (custom order).
   * Folders stay above files: a slot among the other kind moves to the edge.
   */
  dropTarget(row, el, x, y) {
    if (!el || !this.el.contains(el) || this.bar.contains(el) || this.filter) { this.hoverEnd(); return null; }
    const paths = this.dragged(row);
    const canGo = (dir) => paths.every((p) => dirname(p) === dir || canMoveInto(p, dir));
    const over = el.closest('.tree-row');
    if (over === row || (over && over.classList.contains('tree-edit'))) { this.hoverEnd(); return null; }
    if (!over) { this.hoverEnd(); return canGo('') ? this.slotAt(row, '', null) : null; }
    const r = over.getBoundingClientRect();
    const f = (y - r.top) / (r.height || 1);
    const isDir = over.dataset.kind === 'directory';
    if (isDir && f > 0.25 && f < 0.75) {
      const seg = el.closest('.tseg');
      const dir = seg ? seg.dataset.seg : over.dataset.path;
      this.hoverOver(over.classList.contains('open') ? null : over.dataset.path);
      return paths.every((p) => canMoveInto(p, dir)) ? { el: over, cls: 'drop-into', dir } : null;
    }
    this.hoverEnd();
    const entry = entryOf(over);
    if (isDir ? f <= 0.25 : f < 0.5) return canGo(dirname(entry)) ? this.slotAt(row, dirname(entry), basename(entry)) : null;
    if (isDir && over.classList.contains('open')) {
      const kids = this.childRows(over.dataset.path, row);
      return canGo(over.dataset.path) ? this.slotAt(row, over.dataset.path, kids.length ? kids[0].name : null) : null;
    }
    const dir = dirname(entry);
    if (!canGo(dir)) return null;
    const kids = this.childRows(dir, row);
    const i = kids.findIndex((k) => k.el === over);
    return this.slotAt(row, dir, i >= 0 && kids[i + 1] ? kids[i + 1].name : null);
  }

  /** The rows of `dir`'s own entries, in order (not the dragged row, not deeper rows). */
  childRows(dir, row) {
    const head = dir ? this.rowFor(dir) : null;
    if (dir && !head) return [];
    const depth = head ? depthOf(head) + 1 : 0;
    const out = [];
    for (let n = head ? head.nextElementSibling : this.rowsEl.firstElementChild; n; n = n.nextElementSibling) {
      if (n === row || !n.matches('.tree-row[data-path]') || n.classList.contains('drag-hidden')) continue;
      const d = depthOf(n);
      if (d < depth) break;
      if (d === depth) out.push({ name: basename(entryOf(n)), dir: n.dataset.kind === 'directory', el: n });
    }
    return out;
  }

  /** A slot in `dir` before the entry named `before` (null = the end), kept on the dragged entry's side of folders / files. */
  slotAt(row, dir, before) {
    const kids = this.childRows(dir, row);
    let i = before == null ? kids.length : kids.findIndex((k) => k.name === before);
    if (i < 0) i = kids.length;
    const firstFile = kids.some((k) => !k.dir) ? kids.findIndex((k) => !k.dir) : kids.length;
    i = row.dataset.kind === 'directory' ? Math.min(i, firstFile) : Math.max(i, firstFile);
    const next = kids[i];
    const head = dir ? this.rowFor(dir) : null;
    return {
      dir, before: next ? next.name : null,
      slot: { parent: this.rowsEl, before: next ? next.el : this.afterFolder(head, row), depth: head ? depthOf(head) + 1 : 0 },
    };
  }

  /** The first row below everything shown inside folder row `head` (null: the end of the tree). */
  afterFolder(head, row) {
    if (!head) return null;
    const depth = depthOf(head);
    for (let n = head.nextElementSibling; n; n = n.nextElementSibling) {
      if (n === row || n.classList.contains('drag-hidden')) continue;
      if (!n.matches('.tree-row[data-path]') || depthOf(n) <= depth) return n;
    }
    return null;
  }

  /** A drag starts / ends: an open folder travels closed; the rest of a dragged selection fades. */
  dragChange(on, row) {
    this.dragging = on;
    if (on) {
      this.dropped = false;
      if (row.dataset.kind === 'directory' && row.classList.contains('open')) {
        const depth = depthOf(row);
        for (let n = row.nextElementSibling; n && n.matches('.tree-row') && depthOf(n) > depth; n = n.nextElementSibling) n.classList.add('drag-hidden');
      }
      const moving = new Set(this.dragged(row));
      for (const r of this.rows.values()) if (r !== row && moving.has(entryOf(r))) r.classList.add('drag-along');
      return;
    }
    this.hoverEnd();
    // After a drop the tree is redrawn anyway (showing the hidden rows first would flash them in the old place).
    if (!this.dropped) for (const r of this.rowsEl.querySelectorAll('.drag-hidden, .drag-along')) r.classList.remove('drag-hidden', 'drag-along');
    const waiting = this.afterDrag;
    this.afterDrag = [];
    for (const resolve of waiting) resolve();
    if (this.dropped && !waiting.length) this.render(); // nothing redrew it yet (nothing changed, or not yet)
  }

  hoverOver(dir) {
    if (this.hover && this.hover.dir === dir) return;
    this.hoverEnd();
    if (!dir) return;
    this.hover = { dir, timer: setTimeout(() => { if (this.dragging && this.hover && this.hover.dir === dir) this.expandInPlace(dir); }, HOVER_OPEN_MS) };
  }

  hoverEnd() {
    if (this.hover) clearTimeout(this.hover.timer);
    this.hover = null;
  }

  /**
   * Opens a folder without redrawing the tree: its rows go in under it. (A
   * redraw would replace the row under the dragging finger, which ends the
   * touch.)
   */
  async expandInPlace(dir) {
    const row = this.rows.get(dir);
    if (!row || this.expanded.has(dir)) return;
    this.expanded.add(dir);
    this.saveExpanded();
    const frag = document.createDocumentFragment();
    await this.renderDir(dir, Number(row.style.getPropertyValue('--depth')) + 1, frag);
    row.classList.add('open');
    row.setAttribute('aria-expanded', 'true');
    const icon0 = row.querySelector('.file-icon');
    if (icon0) icon0.replaceWith(folderIcon(basename(dir), true));
    row.after(frag);
    this.decorate();
  }

  // ---- in-place editing -----------------------------------------------------------------

  /**
   * An editable row: under `dir` for a new entry (kind 'file' / 'directory'),
   * or in place of `path`'s row to rename it. Enter (or leaving the field
   * with a valid name) → the name; Esc or an empty name → null. `validate`
   * returns an error message to show, or null.
   */
  async edit({ dir = '', path = null, kind = 'file', validate = () => null }) {
    if (this.editing) this.editing.cancel();
    if (this.filter) { this.filter = ''; this.deps.onFilterCleared && this.deps.onFilterCleared(); }
    if (!path && dir && !this.expanded.has(dir)) { this.expanded.add(dir); this.saveExpanded(); await this.render(); }
    else if (!path && dir && !this.rowFor(dir)) await this.reveal(dir, { flash: false });
    const old = path ? this.rowFor(path) : null;
    const anchor = path ? old : dir ? this.rowFor(dir) : null;
    const depth = old ? Number(old.style.getPropertyValue('--depth'))
      : anchor ? Number(anchor.style.getPropertyValue('--depth')) + 1 : 0;
    const name0 = path ? basename(path) : '';
    const input = h('input.input.tree-input', {
      type: 'text', value: name0, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
      'aria-label': path ? `New name for ${name0}` : kind === 'directory' ? 'New folder name' : 'New file name',
      placeholder: kind === 'directory' ? 'folder name' : 'file name (css/site.css works too)',
    });
    const error = h('div.tree-edit-error', { 'aria-live': 'polite' });
    const row = h('div.tree-row.tree-edit', { style: { '--depth': depth } },
      h('span.twisty'), kind === 'directory' ? folderIcon(name0 || 'folder', false) : fileIcon(name0 || 'file'),
      h('div.tree-edit-box', input, error));
    if (old) { old.classList.add('hidden'); old.after(row); }
    else if (anchor) anchor.after(row);
    else this.rowsEl.prepend(row);
    row.scrollIntoView({ block: 'nearest' });
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        this.editing = null;
        row.remove();
        if (old) old.classList.remove('hidden');
        resolve(value);
      };
      const commit = () => {
        const v = input.value.trim();
        if (!v || v === name0) { finish(null); return false; }
        const problem = validate(v);
        if (problem) { error.textContent = problem; row.classList.add('invalid'); return false; }
        finish(v);
        return true;
      };
      this.editing = { cancel: () => finish(null) };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      });
      input.addEventListener('input', () => { error.textContent = ''; row.classList.remove('invalid'); });
      // Leaving the field keeps a valid name (as in VS Code); otherwise it is dropped.
      input.addEventListener('blur', () => setTimeout(() => { if (!done && !commit()) finish(null); }, 0));
      requestAnimationFrame(() => {
        input.focus();
        const dot = name0.lastIndexOf('.');
        if (name0 && dot > 0 && kind !== 'directory') input.setSelectionRange(0, dot);
        else input.select();
      });
    });
  }

  // ---- menu & keys ------------------------------------------------------------------------

  menu(path, kind, at) {
    const a = this.deps.actions;
    const isDir = kind === 'directory';
    const inSel = this.selected.has(path) && this.selected.size > 1;
    const paths = inSel ? [...this.selected] : [path];
    const pasteDir = isDir ? path : dirname(path);
    const items = inSel ? [
      { label: `${paths.length} selected`, disabled: true, run: () => {} },
      { label: 'Cut', icon: 'edit', run: () => { a.cut(paths); this.clearSelection(); } },
      { label: 'Copy', icon: 'copy', run: () => { a.copy(paths); this.clearSelection(); } },
      { label: 'Delete', icon: 'trash', danger: true, run: () => { a.removeMany(paths); this.clearSelection(); } },
      '-',
      { label: 'Stop selecting', icon: 'close', run: () => this.clearSelection() },
    ] : [
      isDir && { label: 'New file here', icon: 'newFile', run: () => a.newFile(path) },
      isDir && { label: 'New folder here', icon: 'newFolder', run: () => a.newFolder(path) },
      isDir && { label: 'Upload files here', icon: 'upload', run: () => a.upload(path) },
      isDir && this.deps.getOrder && this.deps.getOrder(path) && { label: 'Sort A–Z', hint: 'forget the order you dragged', run: () => a.sortAZ(path) },
      !isDir && { label: 'Open', icon: 'file', run: () => this.deps.onOpen(path, { keep: true }) },
      !isDir && { label: 'Open to the side', icon: 'split', run: () => a.openToSide(path) },
      '-',
      { label: 'Select', icon: 'check', hint: 'then tap more', run: () => this.startSelecting(path) },
      { label: 'Cut', icon: 'edit', run: () => a.cut([path]) },
      { label: 'Copy', icon: 'copy', run: () => a.copy([path]) },
      a.canPaste() && { label: `Paste into ${pasteDir || 'the project root'}`, icon: 'download', run: () => a.paste(pasteDir) },
      '-',
      { label: 'Rename…', icon: 'rename', hint: 'F2', run: () => a.rename(path, kind) },
      { label: 'Duplicate', icon: 'copy', run: () => a.duplicate(path, kind) },
      { label: 'Copy path', icon: 'copy', run: () => a.copyPath(path) },
      !isDir && { label: 'Download', icon: 'download', run: () => a.download(path) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, hint: 'to the trash', run: () => a.remove(path, kind) },
    ];
    popupMenu(items.filter(Boolean), at);
  }

  onKey(e) {
    if (this.editing || e.target.closest('input, textarea')) return;
    const a = this.deps.actions;
    const row = e.target.closest('.tree-row[data-path]');
    const path = row ? row.dataset.path : this.focus;
    const sel = this.selected.size ? [...this.selected] : path ? [path] : [];
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F2' && path) { e.preventDefault(); a.rename(path, (row || this.rowFor(path)).dataset.kind); }
    else if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && sel.length) { e.preventDefault(); a.removeMany(sel); this.clearSelection(); }
    else if (mod && e.key.toLowerCase() === 'c' && sel.length) { e.preventDefault(); a.copy(sel); }
    else if (mod && e.key.toLowerCase() === 'x' && sel.length) { e.preventDefault(); a.cut(sel); }
    else if (mod && e.key.toLowerCase() === 'v' && a.canPaste()) { e.preventDefault(); a.paste(this.targetDir()); }
    else if (e.key === 'Escape' && (this.selected.size > 1 || this.multi)) { e.preventDefault(); this.clearSelection(); }
    else return;
    e.stopPropagation();
  }
}
