// ui/fileTree.js — the project file tree (spec §2 Phase 1: lazy loading,
// default-hidden .git/node_modules/build).
//
// Folders load their children only when expanded (one directory listing per
// expand), so opening a project with a huge node_modules costs nothing.
// Touch: tap opens, long-press opens the context menu (rename, delete, …).

import { h, icon, onLongPress } from './dom.js';
import { popupMenu } from './overlays.js';
import { extname } from '../core/paths.js';

const TYPE_BADGES = {
  '.js': ['JS', '#e8c547', '#1a1a1a'], '.mjs': ['JS', '#e8c547', '#1a1a1a'], '.cjs': ['JS', '#e8c547', '#1a1a1a'],
  '.jsx': ['JX', '#61dafb', '#10202a'], '.ts': ['TS', '#3178c6', '#fff'], '.tsx': ['TX', '#3178c6', '#fff'],
  '.html': ['<>', '#e5683b', '#fff'], '.htm': ['<>', '#e5683b', '#fff'], '.css': ['#', '#5b8ef0', '#fff'],
  '.scss': ['S', '#cd6799', '#fff'], '.json': ['{}', '#a8a03c', '#fff'], '.md': ['M↓', '#6b8fb3', '#fff'],
  '.py': ['Py', '#3d78b0', '#ffd43b'], '.c': ['C', '#5c6bc0', '#fff'], '.h': ['H', '#7986cb', '#fff'],
  '.cpp': ['C+', '#00599c', '#fff'], '.hpp': ['H+', '#00599c', '#fff'], '.java': ['Jv', '#e76f00', '#fff'],
  '.kt': ['Kt', '#8f62e8', '#fff'], '.go': ['Go', '#00add8', '#fff'], '.rs': ['Rs', '#b7410e', '#fff'],
  '.sh': ['$', '#4caf50', '#fff'], '.yml': ['Y', '#cb171e', '#fff'], '.yaml': ['Y', '#cb171e', '#fff'],
  '.svg': ['Sv', '#ffb13b', '#1a1a1a'], '.png': ['Im', '#26a69a', '#fff'], '.jpg': ['Im', '#26a69a', '#fff'],
  '.jpeg': ['Im', '#26a69a', '#fff'], '.gif': ['Im', '#26a69a', '#fff'], '.webp': ['Im', '#26a69a', '#fff'],
  '.txt': ['Tx', '#8a919c', '#fff'], '.sql': ['Sq', '#e38c00', '#fff'], '.xml': ['X', '#8a6d3b', '#fff'],
};

export function fileBadge(name) {
  const b = TYPE_BADGES[extname(name)];
  if (!b) return h('span.file-icon', { html: icon('file', 16), style: { color: 'var(--text-faint)' } });
  return h('span.file-icon', { style: { background: b[1], color: b[2] } }, b[0]);
}

export class FileTree {
  /**
   * @param {HTMLElement} container
   * @param {object} deps {getFs, isHidden(name), onOpen(path), actions:{...}, getGitBadges():Map, getOpenState():{active, dirty:Set}}
   */
  constructor(container, deps) {
    this.el = container;
    this.deps = deps;
    this.expanded = new Set();
    this.cache = new Map(); // dir -> entries
    this.rows = new Map();  // path -> row element
    this.el.classList.add('tree');
    this.el.setAttribute('role', 'tree');
    onLongPress(this.el, '.tree-row', (row, at) => this.menu(row.dataset.path, row.dataset.kind, at));
  }

  async reset(expanded = []) {
    this.cache.clear();
    this.expanded = new Set(expanded);
    await this.render();
  }

  async list(dir) {
    if (!this.cache.has(dir)) {
      const fs = this.deps.getFs();
      let entries = [];
      try { entries = fs ? await fs.list(dir) : []; } catch { entries = []; }
      this.cache.set(dir, entries);
    }
    return this.cache.get(dir).filter((e) => !this.deps.isHidden(e.name));
  }

  /** Re-reads the given folders (or all expanded ones) from storage. */
  async refresh(dirs = null) {
    if (dirs) for (const d of dirs) this.cache.delete(d);
    else this.cache.clear();
    await this.render();
  }

  async render() {
    const fs = this.deps.getFs();
    const frag = document.createDocumentFragment();
    this.rows.clear();
    if (fs) await this.renderDir('', 0, frag);
    this.el.textContent = '';
    this.el.append(frag);
    if (fs && !this.el.children.length) {
      this.el.append(h('div.panel-note', 'This project is empty. Create a file with the ', h('b', '+'), ' button above.'));
    }
    this.decorate();
  }

  async renderDir(dir, depth, into) {
    for (const e of await this.list(dir)) {
      const open = this.expanded.has(e.path);
      const row = h('button.tree-row', {
        type: 'button', role: 'treeitem', 'aria-expanded': e.kind === 'directory' ? String(open) : null,
        class: (e.kind === 'directory' ? 'dir' : 'file') + (open ? ' open' : ''),
        style: { '--depth': depth }, dataset: { path: e.path, kind: e.kind }, title: e.path,
        onclick: () => this.activate(e),
      },
      h('span.twisty', { html: e.kind === 'directory' ? icon('chevronRight', 14) : '' }),
      e.kind === 'directory' ? h('span.file-icon', { html: icon(open ? 'folderOpen' : 'folder', 16), style: { color: 'var(--accent)' } }) : fileBadge(e.name),
      h('span.tname', e.name),
      h('span.tbadge'));
      this.rows.set(e.path, row);
      into.append(row);
      if (e.kind === 'directory' && open) await this.renderDir(e.path, depth + 1, into);
    }
  }

  async activate(e) {
    if (e.kind === 'directory') {
      if (this.expanded.has(e.path)) this.expanded.delete(e.path);
      else this.expanded.add(e.path);
      this.deps.onExpandChange && this.deps.onExpandChange([...this.expanded]);
      await this.render();
    } else {
      this.deps.onOpen(e.path);
    }
  }

  /** Expands parents and scrolls the file into view. */
  async reveal(path) {
    const parts = path.split('/');
    let changed = false;
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!this.expanded.has(dir)) { this.expanded.add(dir); changed = true; }
    }
    if (changed) await this.render();
    const row = this.rows.get(path);
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
      row.classList.add('focused');
      setTimeout(() => row.classList.remove('focused'), 1200);
    }
  }

  collapseAll() {
    this.expanded.clear();
    this.deps.onExpandChange && this.deps.onExpandChange([]);
    this.render();
  }

  /** Marks the active file, unsaved files and git status letters. */
  decorate() {
    const { active, dirty } = this.deps.getOpenState();
    const badges = this.deps.getGitBadges ? this.deps.getGitBadges() : new Map();
    for (const [path, row] of this.rows) {
      row.classList.toggle('active', path === active);
      row.classList.toggle('dirty', dirty.has(path));
      const b = row.querySelector('.tbadge');
      const letter = badges.get(path) || '';
      b.textContent = letter;
      b.className = `tbadge ${letter}`;
    }
  }

  menu(path, kind, at) {
    const a = this.deps.actions;
    const isDir = kind === 'directory';
    const items = [
      isDir && { label: 'New file here', icon: 'newFile', run: () => a.newFile(path) },
      isDir && { label: 'New folder here', icon: 'newFolder', run: () => a.newFolder(path) },
      isDir && { label: 'Upload files here', icon: 'upload', run: () => a.upload(path) },
      !isDir && { label: 'Open', icon: 'file', run: () => this.deps.onOpen(path) },
      !isDir && { label: 'Open to the side', icon: 'split', run: () => a.openToSide(path) },
      '-',
      { label: 'Rename…', icon: 'edit', run: () => a.rename(path, kind) },
      { label: 'Duplicate', icon: 'copy', run: () => a.duplicate(path, kind) },
      { label: 'Copy path', icon: 'copy', run: () => a.copyPath(path) },
      !isDir && { label: 'Download', icon: 'download', run: () => a.download(path) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, run: () => a.remove(path, kind) },
    ];
    popupMenu(items.filter(Boolean), at);
  }
}
