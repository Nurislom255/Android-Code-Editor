// app/app.js — the composition root: creates every part and wires them up.
// Each part (workspace, panels, keys bar, runner…) knows nothing about the
// others; this file is the only place that connects them.

import { EditorView } from '@codemirror/view';
import { setDiagnosticsEffect, forEachDiagnostic } from '@codemirror/lint';
import { foldAll, unfoldAll } from '@codemirror/language';
import { indentSelection } from '@codemirror/commands';
import { Workspace, minimalChange, externalAnno } from './workspace.js';
import { PreviewController } from './previewController.js';
import { renderTabBar, renderCrumbs, renderConflict, renderStatus, renderWelcome, gestureCheatSheet } from './chrome.js';
import { normalizeSettings, ignoreNames, GESTURE_ACTIONS, DEFAULTS } from '../core/settings.js';
import { IgnoreRules } from '../core/ignore.js';
import { dirname, basename, join, validateName, normalize } from '../core/paths.js';
import { RecoveryStore } from '../storage/recovery.js';
import { LocalHistory } from '../storage/localHistory.js';
import { kv } from '../storage/db.js';
import { walkFiles, isFolderPickerSupported, isOpfsSupported } from '../storage/projectFs.js';
import { getCapacitorFilesystem } from '../storage/capacitorFs.js';
import {
  listProjects, createBrowserProject, deleteBrowserProject, pickFolderProject, deviceProject, fsForProject,
  touchProject, forgetProject, permissionState, requestFolderPermission, requestPersistentStorage,
} from '../storage/projects.js';
import { LANGUAGES, PLAIN } from '../editor/languages.js';
import * as E from '../editor/editActions.js';
import { completeStatement } from '../editor/semicolons.js';
import { setEditorEnv } from '../editor/context.js';
import { attachGestures, attachStripSwipe } from '../editor/gestureLayer.js';
import { symbolsFor } from '../editor/viewPlugins.js';
import { flattenSymbols } from '../editor/outline.js';
import { syntaxDiagnostics } from '../editor/syntaxLint.js';
import { h, icon, $, $$, hydrateIcons, debounce, haptic, formatTime, trackHoverInput } from '../ui/dom.js';
import { choose, confirm, prompt, toast, popupMenu, showModal, isModalOpen, closeMenus } from '../ui/overlays.js';
import { Layout } from '../ui/layout.js';
import { Palette } from '../ui/palette.js';
import { FileTree } from '../ui/fileTree.js';
import { SearchPanel, OutlinePanel, HistoryPanel, showDiff } from '../ui/panels.js';
import { GitPanel, loadGit } from '../ui/gitPanel.js';
import { SettingsPanel } from '../ui/settingsPanel.js';
import { BottomPanel } from '../ui/bottomPanel.js';
import { KeysBar } from '../ui/keysBar.js';
import { JsRunner } from '../run/jsRunner.js';
import { formatText, canFormat } from '../run/format.js';
import { BOILERPLATE_FILES, CONSOLE_STARTER } from '../core/boilerplate.js';

const SETTINGS_KEY = 'codeeditor:settings';
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const BUILT = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { return normalizeSettings({}); }
}

export class App {
  constructor() {
    this.settings = loadSettings();
    this.project = null;
    this.gitBranch = null;
    this.gitBadges = new Map();
    this.recentFiles = [];
    this.problemCounts = { errors: 0, warnings: 0 };
    hydrateIcons();
    trackHoverInput();
    this.applyTheme();
    this.applyFont();
    this.applyUiZoom();
    // Must be decided before any editor view exists (see settings.js).
    EditorView.EDIT_CONTEXT = this.settings.androidEditContext;

    this.layout = new Layout({
      getSettings: () => this.settings,
      saveSettings: (s) => this.saveSettings(s),
      onChange: () => this.layoutChanged(),
    });
    this.layout.applySizes(this.settings);

    this.recovery = new RecoveryStore();
    this.history = new LocalHistory({ days: this.settings.historyDays, maxPerFile: this.settings.historyMaxPerFile });
    this.history.prune();

    const ui = { choose, prompt, toast: (m, k, d) => toast(m, k, d) };
    this.ws = new Workspace({
      getSettings: () => this.settings,
      recovery: this.recovery,
      history: this.history,
      ui,
      extensions: [EditorView.updateListener.of((u) => {
        if (u.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)))) this.problemsLater();
      })],
    });
    this.ws.gitBaseProvider = (path) => this.git.headText(path);
    this.ws.beforeSaveHook = (doc) => (this.settings.formatOnSave && canFormat(doc.lang.id) ? this.formatDoc(doc.id, { quiet: true }) : null);
    this.ws.attachPane(0, $('#pane-0 .editor-host'));

    this.palette = new Palette({
      commands: () => this.commandList(),
      files: () => this.projectFiles(),
      openFile: (p) => this.ws.openPath(p),
      symbols: () => this.symbolItems(),
      gotoLine: (n, c) => { const d = this.ws.activeDoc; if (d) this.ws.revealLine(d.id, n, c); },
      lineInfo: () => { const d = this.ws.activeDoc; return d ? `Current line ${this.ws.view.state.doc.lineAt(this.ws.view.state.selection.main.head).number} of ${this.ws.view.state.doc.lines}. Type a line number (and :column).` : 'Open a file first.'; },
    });

    this.bottom = new BottomPanel({
      resolvePath: (p) => this.resolveConsolePath(p),
      openAt: (path, line, col, docId) => this.openAt(path, line, col, docId),
      onStop: () => this.runner.stop('stopped'),
      onRerun: () => this.run('run'),
      getSettings: () => this.settings,
      layoutChanged: () => this.layoutChanged(),
      savePanelHeight: (px) => { const st = this.settings; st.panelHeight = px; this.saveSettings(st); },
      isCompact: () => !!(this.layout && this.layout.compact),
    });
    this.bottom.onShowProblems = () => this.updateProblems();
    this.runner = new JsRunner('run-worker.js');
    this.preview = new PreviewController({
      read: (p) => this.readForPreview(p),
      bottom: this.bottom,
      layout: this.layout,
      getSettings: () => this.settings,
      saveSettings: (s) => this.saveSettings(s),
      onConsole: (e) => { this.bottom.log({ level: e.level, text: e.fromPreview ? `${e.text}` : e.text }); },
      isDark: () => document.documentElement.classList.contains('theme-dark'),
      onLayout: () => this.layoutChanged(),
      // Auto-refresh waits while the file being typed doesn't parse (same
      // check as the red underlines), e.g. right after the first "/" of "//".
      syntaxErrorAt: (doc) => {
        if (!doc || !this.ws.docs.has(doc.id) || !['javascript', 'html'].includes(doc.lang.id)) return null;
        const st = this.ws.stateOf(doc.id);
        const d = st && syntaxDiagnostics(st).find((x) => x.severity === 'error');
        return d ? `${doc.path || doc.name}:${st.doc.lineAt(d.from).number}` : null;
      },
    });

    this.buildSidebar();
    setEditorEnv({ projectFiles: () => this.projectFiles() });
    this.keysBar = new KeysBar($('#keys-bar'), {
      getView: () => (this.ws.activeDoc ? this.ws.view : null),
      getSettings: () => this.settings,
      run: (name) => this.run(name),
      arrow: (dir, mods) => E.arrow(this.ws.activeDoc ? this.ws.view : null, dir, mods),
      type: (text) => E.typeText(this.editableView(), text),
      // label + shortcut, for the keys' tooltips
      describe: (name) => { const c = this.commands()[name]; return c ? { label: c.label, key: c.key } : null; },
      isEscapable: () => $('#bottom-panel').classList.contains('maximized'),
      onLayoutChange: () => this.layoutChanged(),
    });

    this.attachPaneUi(0);
    this.bindWorkspaceEvents();
    this.bindTitlebar();
    this.bindShortcuts();
    this.bindLifecycle();
    attachStripSwipe($('#statusbar'), () => this.settings, (dir) => { if (this.run(dir === 'left' ? 'nextTab' : 'prevTab')) this.hint(dir === 'left' ? 'Next tab' : 'Previous tab'); });
    this.renderAll();
  }

  // ---- settings ---------------------------------------------------------------

  saveSettings(s) {
    this.settings = normalizeSettings(s);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage full */ }
  }

  /** Applies a partial change from the Settings panel. */
  updateSettings(patch) {
    const prev = this.settings;
    const next = patch.__reset ? normalizeSettings({ ...DEFAULTS }) : normalizeSettings({ ...prev, ...patch });
    this.saveSettings(next);
    if (prev.theme !== next.theme) this.applyTheme();
    if (prev.fontSize !== next.fontSize) this.applyFont();
    if (prev.uiZoom !== next.uiZoom) this.applyUiZoom();
    if (prev.androidEditContext !== next.androidEditContext) {
      confirm('Reload to apply?', 'The keyboard input mode changes when the app reloads. Unsaved work is kept.', 'Reload').then(async (ok) => {
        if (!ok) return;
        await this.recovery.flushAll();
        this.ws.saveSession();
        location.reload();
      });
    }
    if (prev.sidebarWidth !== next.sidebarWidth || prev.panelHeight !== next.panelHeight) this.layout.applySizes(next);
    if (prev.historyDays !== next.historyDays || prev.historyMaxPerFile !== next.historyMaxPerFile) this.history.configure({ days: next.historyDays, maxPerFile: next.historyMaxPerFile });
    if (prev.ignoreList !== next.ignoreList) { this.fileCache = null; this.tree.refresh(); }
    if (JSON.stringify(prev.keysLayouts) !== JSON.stringify(next.keysLayouts) || prev.keysBarMode !== next.keysBarMode) this.keysBar.refresh();
    if (prev.previewPlacement !== next.previewPlacement && this.preview.target) this.preview.mount();
    this.ws.applySettings(prev, next);
    if (patch.__reset) this.layout.applySizes(next);
    renderWelcome(this, 0);
  }

  applyTheme() {
    const t = this.settings.theme === 'system'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : this.settings.theme;
    document.documentElement.classList.toggle('theme-dark', t === 'dark');
    document.documentElement.classList.toggle('theme-light', t === 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#14161a' : '#ffffff';
    if (!this._themeWatch) {
      this._themeWatch = true;
      matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (this.settings.theme === 'system') this.applyTheme(); });
    }
    if (this.preview && this.preview.target && this.preview.target.kind === 'markdown') this.preview.refresh();
  }

  /** Interface size: everything around the code (see --ui-zoom in styles.css). */
  applyUiZoom() {
    document.documentElement.style.setProperty('--ui-zoom', String(this.settings.uiZoom / 100));
    if (this.ws) this.layoutChanged();
  }

  applyFont(px = this.settings.fontSize) {
    document.documentElement.style.setProperty('--ed-font-size', `${px}px`);
    if (this.ws) for (const p of this.ws.panes) if (p) p.view.requestMeasure();
  }

  // ---- layout -------------------------------------------------------------------

  layoutChanged() {
    if (this.bottom && this.layout && this.bottom._compact !== this.layout.compact) {
      this.bottom._compact = this.layout.compact;
      this.bottom.renderActions(); // phone vs. tablet action set
    }
    const split = !!(this.ws && this.ws.panes[1] && this.ws.panes[1].visible);
    const side = !$('#preview-side').classList.contains('hidden');
    $('#app').classList.toggle('split', split);
    $('#pane-1').classList.toggle('hidden', !split);
    $('#pane-divider').classList.toggle('hidden', !(split || side));
    $('#btn-split').classList.toggle('active', split);
    if (!split && !side) { $('#pane-0').style.flex = ''; }
    if (this.ws) for (const p of this.ws.panes) if (p) p.view.requestMeasure();
    if (this.preview && this.preview.target && this.preview.mountedIn && this.preview.placement() !== this.preview.mountedIn) this.preview.mount();
  }

  // ---- panes ----------------------------------------------------------------------

  attachPaneUi(index) {
    const host = $(`#pane-${index} .editor-host`);
    attachGestures(host, {
      getView: () => (this.ws.panes[index] && this.ws.panes[index].activeId != null ? this.ws.panes[index].view : null),
      getSettings: () => this.settings,
      runGesture: (key, view) => this.runGesture(key, view, index),
      onPinch: (ev) => this.onPinch(ev),
      onLineSelect: (view) => view.focus(),
    });
    $(`#pane-${index}`).addEventListener('pointerdown', () => this.ws.setActivePane(index), true);
    $(`#pane-${index}`).addEventListener('focusin', () => this.ws.setActivePane(index));
    host.addEventListener('contextmenu', (e) => {
      // Mouse right-click → our menu. Touch long-press keeps Android's native
      // text-selection toolbar (copy / paste), which works better there.
      if (e.pointerType === 'touch' || (this._lastPointer === 'touch')) return;
      if (!e.target.closest('.cm-content')) return;
      e.preventDefault();
      this.editorContextMenu({ x: e.clientX, y: e.clientY });
    });
    host.addEventListener('pointerdown', (e) => { this._lastPointer = e.pointerType; }, true);
    renderWelcome(this, index);
  }

  editableView() {
    return this.ws.activeDoc ? this.ws.view : null;
  }

  openInPane(doc, paneIndex, move = false) {
    if (paneIndex === 1) this.split({ copyActive: false });
    const from = this.ws.paneFor(doc.id).index;
    if (move) this.ws.moveTab(from, doc.id, paneIndex);
    else {
      const st = this.ws.stateOf(doc.id);
      this.ws._addToPane(this.ws.panes[paneIndex], doc, { selection: { anchor: st.selection.main.anchor, head: st.selection.main.head } });
      this.ws.showDoc(paneIndex, doc.id);
    }
  }

  split({ copyActive = true } = {}) {
    const first = !this.ws.panes[1];
    this.ws.split($('#pane-1 .editor-host'), { copyActive });
    if (first) this.attachPaneUi(1);
    this.layoutChanged();
    this.renderAll();
  }

  async toggleSplit() {
    if (this.ws.panes[1] && this.ws.panes[1].visible) await this.ws.unsplit();
    else this.split();
    this.layoutChanged();
    this.renderAll();
  }

  // ---- rendering -------------------------------------------------------------------

  renderAll() {
    for (const i of [0, 1]) {
      if (!this.ws.panes[i]) continue;
      renderTabBar(this, i);
      renderCrumbs(this, i);
      renderConflict(this, i);
      $(`#pane-${i}`).classList.toggle('focused-pane', this.ws.activePane === i);
    }
    renderStatus(this);
    this.tree && this.tree.decorate();
    $('#project-name').textContent = this.project ? this.project.meta.name : 'No project';
    document.title = this.ws.activeDoc ? `${this.ws.activeDoc.dirty ? '● ' : ''}${this.ws.activeDoc.name} — CodeEditor` : 'CodeEditor';
    $('#btn-save').classList.toggle('active', !!(this.ws.activeDoc && this.ws.activeDoc.dirty));
  }

  bindWorkspaceEvents() {
    const ws = this.ws;
    const frame = (fn) => { let raf = 0; return () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fn(); }); }; };
    const statusLater = frame(() => { renderStatus(this); renderCrumbs(this, ws.activePane); });
    const outlineLater = debounce(() => { if (this.activePanel === 'outline') this.outline.render(); }, 500);
    ws.on('docs', frame(() => this.renderAll()));
    ws.on('active', ({ doc }) => {
      this.renderAll();
      this.keysBar.setLanguage(doc ? doc.lang.id : 'plain');
      this.keysBar.update();
      if (this.activePanel === 'outline') this.outline.render();
      if (this.activePanel === 'history') this.historyPanel.render();
      if (doc && doc.path) this.rememberRecent(doc.path);
      this.problemsLater();
    });
    ws.on('selection', ({ state, docChanged }) => {
      statusLater();
      this.keysBar.editorChanged(!!docChanged);
      if (this.activePanel === 'outline') this.outline.setCursor(state.selection.main.head);
    });
    ws.on('change', ({ doc }) => {
      outlineLater();
      this.preview.changed(doc);
    });
    ws.on('saved', ({ doc }) => {
      this.preview.changed();
      if (this.activePanel === 'git') this.gitLater();
      if (this.activePanel === 'history') this.historyPanel.render();
      if (doc.path && !this.treeHas(doc.path)) this.tree.refresh([dirname(doc.path)]);
    });
    ws.on('conflict', () => { renderConflict(this, 0); renderConflict(this, 1); });
    ws.on('compare', ({ doc, diskText }) => this.compareWithDisk(doc, diskText));
    ws.on('tree-changed', ({ path }) => { this.fileCache = null; this.tree.refresh([dirname(path)]); });
    ws.on('want-split', () => this.split({ copyActive: false }));
    ws.on('split', () => this.layoutChanged());
    this.gitLater = debounce(() => this.git.refresh(), 600);
  }

  treeHas(path) {
    return this.tree.rows.has(path);
  }

  // ---- sidebar --------------------------------------------------------------------

  buildSidebar() {
    const panelEl = (id) => $(`.side-panel[data-panel="${id}"]`);
    // Files
    const files = panelEl('files');
    files.append(h('div.panel-header',
      h('span.title', { id: 'files-title' }, 'Files'),
      h('button.icon-btn.small', { type: 'button', title: 'New file', 'aria-label': 'New file', icon: 'newFile', onclick: () => this.actions.newFile('') }),
      h('button.icon-btn.small', { type: 'button', title: 'New folder', 'aria-label': 'New folder', icon: 'newFolder', onclick: () => this.actions.newFolder('') }),
      h('button.icon-btn.small', { type: 'button', title: 'Refresh', 'aria-label': 'Refresh file tree', icon: 'refresh', onclick: () => { this.fileCache = null; this.tree.refresh(); } }),
      h('button.icon-btn.small', { type: 'button', title: 'More', 'aria-label': 'More file actions', icon: 'more', onclick: (e) => this.filesMenu(e) })));
    const treeEl = h('div.panel-scroll');
    files.append(treeEl);
    this.actions = this.fileActions();
    this.tree = new FileTree(treeEl, {
      getFs: () => (this.project ? this.project.fs : null),
      isHidden: (name) => ignoreNames(this.settings).includes(name),
      onOpen: (p) => { this.ws.openPath(p); this.layout.closeDrawer(); },
      onExpandChange: (list) => { if (this.project) kv.set(`expanded:${this.project.meta.id}`, list).catch(() => {}); },
      getGitBadges: () => this.gitBadges,
      getSettings: () => this.settings,
      getOpenState: () => ({
        active: this.ws.activeDoc ? this.ws.activeDoc.path : null,
        dirty: new Set(this.ws.dirtyDocs().map((d) => d.path).filter(Boolean)),
      }),
      actions: this.actions,
    });

    this.search = new SearchPanel(panelEl('search'), {
      listFiles: () => this.projectFiles(),
      readText: (p) => this.readTextForSearch(p),
      open: async (path, line, col, len) => {
        const doc = await this.ws.openPath(path, { line, col });
        if (doc) {
          const st = this.ws.stateOf(doc.id);
          const ln = st.doc.line(line);
          this.ws.revealPos(doc.id, ln.from + col - 1, ln.from + col - 1 + len);
        }
        this.layout.closeDrawer();
      },
    });
    this.outline = new OutlinePanel(panelEl('outline'), {
      getSymbols: () => {
        const d = this.ws.activeDoc;
        if (!d) return null;
        return { symbols: symbolsFor(this.ws.view.state), lezer: !!d.lang.lezer, langName: d.lang.name };
      },
      reveal: (pos) => { const d = this.ws.activeDoc; if (d) this.ws.revealPos(d.id, pos); this.layout.closeDrawer(); },
    });
    this.git = new GitPanel(panelEl('git'), {
      getFs: () => (this.project ? this.project.fs : null),
      getSettings: () => this.settings,
      saveSettings: (s) => this.saveSettings(s),
      openFile: (p) => { this.ws.openPath(p); this.layout.closeDrawer(); },
      bufferText: (p) => { const d = this.ws.allDocs().find((x) => x.path === p); return d ? this.ws.textOf(d.id) : null; },
      onStatus: (badges, branch) => { this.gitBadges = badges; this.gitBranch = branch; this.tree.decorate(); renderStatus(this); },
      afterWorkingTreeChange: () => { this.fileCache = null; this.tree.refresh(); this.ws.checkExternalChanges(); this.ws.refreshGitBases(); },
      afterCommit: () => this.ws.refreshGitBases(),
      saveAllBeforeCommit: () => this.ws.saveAll(),
      hasDirtyBuffers: () => this.ws.dirtyDocs().length > 0,
      pick: (items, o) => this.palette.pick(items, o),
      cloneIntoNewProject: () => this.cloneRepo(),
    });
    this.historyPanel = new HistoryPanel(panelEl('history'), {
      getDoc: () => this.ws.activeDoc,
      list: (key) => this.history.list(key),
      currentText: (doc) => this.ws.textOf(doc.id),
      restore: (doc, content) => {
        const ch = minimalChange(this.ws.textOf(doc.id), content);
        if (ch) this.ws.dispatchToDoc(doc.id, { changes: ch, annotations: externalAnno.of('history-restore'), userEvent: 'input.restore' });
        toast('Snapshot restored into the editor — save to keep it (undo works too).', 'success');
      },
    });
    this.settingsPanel = new SettingsPanel(panelEl('settings'), {
      get: () => this.settings,
      set: (patch) => this.updateSettings(patch),
      extras: {
        version: VERSION,
        built: BUILT,
        // The Android app updates with a new APK, not from the website.
        checkUpdate: window.Capacitor ? null : () => this.checkForUpdate(),
        showShortcuts: () => this.showShortcuts(),
        showGestures: () => this.showGestureGuide(),
        storageInfo: () => this.storageInfo(),
      },
    });

    // Activity bar + phone sidebar tabs
    const tabs = $('.sidebar-tabs');
    for (const btn of $$('#activitybar .activity')) {
      const clone = btn.cloneNode(true);
      tabs.append(clone);
      for (const b of [btn, clone]) b.addEventListener('click', () => this.togglePanel(b.dataset.panel));
    }
    this.showPanel('files', { reveal: false });
  }

  showPanel(id, { reveal = true, focus = false } = {}) {
    this.activePanel = id;
    for (const p of $$('.side-panel')) p.classList.toggle('active', p.dataset.panel === id);
    for (const b of $$('.activity')) b.classList.toggle('active', b.dataset.panel === id);
    if (reveal) this.layout.showSidebar(true);
    if (id === 'outline') this.outline.render();
    if (id === 'git') this.git.refresh();
    if (id === 'history') this.historyPanel.render();
    if (id === 'settings') this.settingsPanel.render();
    if (id === 'search' && focus) this.search.focus(this.selectedText());
  }

  togglePanel(id) {
    if (this.activePanel === id && this.layout.isSidebarVisible() && !this.layout.compact) this.layout.showSidebar(false);
    else this.showPanel(id);
  }

  selectedText() {
    const d = this.ws.activeDoc;
    if (!d) return '';
    const s = this.ws.view.state;
    const r = s.selection.main;
    const t = s.sliceDoc(r.from, r.to);
    return t.includes('\n') ? '' : t;
  }

  revealInTree(path) {
    this.showPanel('files');
    this.tree.reveal(path);
  }

  // ---- projects ---------------------------------------------------------------------

  async start() {
    requestPersistentStorage();
    this.registerServiceWorker();
    await this.ws.restoreRecovery(); // loose / untitled buffers
    let lastId = null;
    try { lastId = await kv.get('lastProject'); } catch { /* ignore */ }
    const projects = await listProjects();
    this.knownProjects = projects;
    const last = projects.find((p) => p.id === lastId);
    if (last) {
      const perm = await permissionState(last);
      if (perm === 'granted') { await this.openProject(last, { quiet: true }); return; }
      this.pendingReconnect = last;
    }
    renderWelcome(this, 0);
    this.renderAll();
  }

  async openProject(meta, { quiet = false } = {}) {
    let fs;
    try {
      fs = await fsForProject(meta);
    } catch (err) {
      if (!quiet) toast(`Could not open ${meta.name}: ${err.message}`, 'error');
      if (err.code === 'EACCES') { this.pendingReconnect = meta; renderWelcome(this, 0); }
      return false;
    }
    this.pendingReconnect = null;
    this.project = { meta, fs };
    this.fileCache = null;
    this.gitBadges = new Map();
    this.gitBranch = null;
    await touchProject(meta);
    try { await kv.set('lastProject', meta.id); } catch { /* ignore */ }
    try { this.recentFiles = (await kv.get(`recent:${meta.id}`)) || []; } catch { this.recentFiles = []; }
    let expanded = [];
    try { expanded = (await kv.get(`expanded:${meta.id}`)) || []; } catch { /* ignore */ }
    await this.tree.reset(expanded);
    await this.ws.setProject(this.project);
    $('#files-title').textContent = meta.name;
    renderWelcome(this, 0);
    this.renderAll();
    this.git.refresh().catch(() => {});
    if (!this.layout.compact && !this.layout.isSidebarVisible() && this.layout.size === 'expanded') this.layout.showSidebar(true);
    return true;
  }

  rememberRecent(path) {
    if (!this.project) return;
    this.recentFiles = [path, ...this.recentFiles.filter((p) => p !== path)].slice(0, 20);
    kv.set(`recent:${this.project.meta.id}`, this.recentFiles).catch(() => {});
  }

  async newBrowserProject() {
    const name = await prompt({ title: 'New project', label: 'Project name', value: 'my-project', validate: validateName, selectBase: false });
    if (!name) return;
    const template = await choose({
      title: 'Start with…',
      message: 'Files to create in the new project.',
      buttons: [{ id: 'web', label: 'Web page (HTML/CSS/JS)', kind: 'primary' }, { id: 'js', label: 'JavaScript (console)' }, { id: 'empty', label: 'Empty' }],
    });
    if (!template) return;
    let meta;
    try { meta = await createBrowserProject(name); } catch (err) { toast(err.message, 'error'); return; }
    const fs = await fsForProject(meta);
    const files = template === 'web' ? BOILERPLATE_FILES : template === 'js' ? CONSOLE_STARTER : [];
    for (const f of files) await fs.writeBytes(f.name, new TextEncoder().encode(f.content));
    await this.openProject(meta);
    const first = template === 'web' ? 'index.html' : template === 'js' ? 'main.js' : null;
    if (first) await this.ws.openPath(first);
    this.closeProjectModal();
  }

  async openFolder() {
    try {
      const meta = await pickFolderProject();
      await this.openProject(meta);
      this.closeProjectModal();
    } catch (err) {
      if (err.name !== 'AbortError') toast(`Could not open folder: ${err.message}`, 'error');
    }
  }

  async openDeviceFolder() {
    const plugin = getCapacitorFilesystem();
    if (!plugin) return;
    const path = await prompt({ title: 'Open a device folder', label: 'Folder path inside shared storage (needs "All files access")', value: 'Documents/Projects', selectBase: false });
    if (!path) return;
    const meta = deviceProject(path.replace(/^\/+/, ''), 'EXTERNAL_STORAGE');
    try {
      await plugin.mkdir({ path: meta.rootPath, directory: 'EXTERNAL_STORAGE', recursive: true }).catch(() => {});
      await touchProject(meta);
      await this.openProject(meta);
      this.closeProjectModal();
    } catch (err) {
      toast(`Could not open ${path}: ${err.message}`, 'error');
    }
  }

  async reconnect(meta) {
    // Runs inside the tap handler: requestPermission needs user activation.
    if (await requestFolderPermission(meta)) await this.openProject(meta);
    else toast('Permission was not granted.', 'warn');
  }

  async importZip(file) {
    const { unzipSync } = await import('fflate');
    let entries;
    try { entries = unzipSync(new Uint8Array(await file.arrayBuffer())); } catch (err) { toast(`Not a valid zip: ${err.message}`, 'error'); return; }
    let paths = Object.keys(entries).filter((p) => !p.endsWith('/') && !p.startsWith('__MACOSX/') && !p.split('/').pop().startsWith('._'));
    // Zips made by "compress folder" wrap everything in one top folder; drop it.
    const tops = new Set(paths.map((p) => p.split('/')[0]));
    const strip = tops.size === 1 && paths.every((p) => p.includes('/')) ? `${[...tops][0]}/` : '';
    const name = await prompt({ title: 'Import .zip as project', label: 'Project name', value: (strip ? strip.slice(0, -1) : file.name.replace(/\.zip$/i, '')) || 'imported', validate: validateName, selectBase: false });
    if (!name) return;
    let meta;
    try { meta = await createBrowserProject(name); } catch (err) { toast(err.message, 'error'); return; }
    const fs = await fsForProject(meta);
    paths = paths.map((p) => [p, normalize(strip ? p.slice(strip.length) : p)]).filter(([, p]) => p);
    for (const [src, dst] of paths) {
      const dir = dirname(dst);
      if (dir) await fs.createDir(dir, { recursive: true });
      await fs.writeBytes(dst, entries[src]);
    }
    toast(`Imported ${paths.length} files into "${name}".`, 'success');
    await this.openProject(meta);
    this.closeProjectModal();
  }

  async importFolderFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const top = (files[0].webkitRelativePath || files[0].name).split('/')[0];
    const name = await prompt({ title: 'Import folder as project', label: 'Project name', value: top || 'imported', validate: validateName, selectBase: false });
    if (!name) return;
    let meta;
    try { meta = await createBrowserProject(name); } catch (err) { toast(err.message, 'error'); return; }
    const fs = await fsForProject(meta);
    for (const f of files) {
      const rel = normalize((f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name);
      if (!rel) continue;
      const dir = dirname(rel);
      if (dir) await fs.createDir(dir, { recursive: true });
      await fs.writeBytes(rel, new Uint8Array(await f.arrayBuffer()));
    }
    toast(`Imported ${files.length} files into "${name}".`, 'success');
    await this.openProject(meta);
    this.closeProjectModal();
  }

  async exportZip() {
    if (!this.project) return;
    const { zipSync } = await import('fflate');
    const fs = this.project.fs;
    const skipNames = new Set(ignoreNames(this.settings).filter((n) => n !== '.git'));
    const paths = await walkFiles(fs, { skip: (p, isDir, name) => skipNames.has(name) });
    const tree = {};
    for (const p of paths) {
      const doc = this.ws.allDocs().find((d) => d.path === p);
      tree[`${this.project.meta.name}/${p}`] = doc && doc.dirty ? new TextEncoder().encode(this.ws.textOf(doc.id)) : (await fs.readBytes(p)).bytes;
    }
    const zip = zipSync(tree, { level: 6 });
    this.downloadBytes(zip, `${this.project.meta.name}.zip`, 'application/zip');
    toast(`Exported ${paths.length} files (unsaved edits included).`, 'success');
  }

  async cloneRepo() {
    const url = await prompt({ title: 'Clone a git repository', label: 'HTTPS URL', placeholder: 'https://github.com/user/repo.git', validate: (v) => (/^https?:\/\/.+/.test(v) ? null : 'Use an https:// URL.') });
    if (!url) return;
    const guess = url.replace(/\.git$/, '').split('/').pop() || 'repo';
    const name = await prompt({ title: 'Project name', label: 'Name for the cloned project', value: guess, validate: validateName, selectBase: false });
    if (!name) return;
    let meta;
    try { meta = await createBrowserProject(name); } catch (err) { toast(err.message, 'error'); return; }
    const fs = await fsForProject(meta);
    const { GitService } = await loadGit();
    const svc = new GitService(fs);
    toast(`Cloning ${url}… this can take a while.`, 'info', 8000);
    try {
      await svc.clone({ url, corsProxy: this.settings.gitCorsProxy });
      toast('Cloned.', 'success');
      await this.openProject(meta);
      this.closeProjectModal();
    } catch (err) {
      toast(`Clone failed: ${err.message}. Private repos need a token (use Pull after setting the remote), and browsers need the CORS proxy from Settings → Git.`, 'error');
      await deleteBrowserProject(name).catch(() => {});
    }
  }

  projectPickerView() {
    const card = (iconName, title, desc, run, enabled = true) => h('button.action-card', { type: 'button', disabled: !enabled, onclick: run }, h('span', { html: icon(iconName, 22) }), h('span.ac-text', h('span.ac-title', title), h('span.ac-desc', desc)));
    const list = h('div.project-list');
    const view = h('div.welcome',
      h('h1', 'CodeEditor'),
      h('p.sub', 'An offline code editor for phones and tablets. Swipe right on the code to autocomplete; long-press anything for more.'),
      this.pendingReconnect ? h('div.project-row', h('div.pr-main', h('span.pr-name', `Reopen “${this.pendingReconnect.name}”`), h('span.pr-meta', 'The browser needs your permission again for this folder.')),
        h('button.btn.btn-primary', { type: 'button', onclick: () => this.reconnect(this.pendingReconnect) }, 'Reconnect')) : null,
      h('h3', 'Start'),
      h('div.action-grid',
        card('plus', 'New project', 'Stored privately in this app (works offline)', () => this.newBrowserProject(), isOpfsSupported()),
        isFolderPickerSupported() ? card('folder', 'Open folder', 'A real folder on this device', () => this.openFolder()) : null,
        getCapacitorFilesystem() ? card('device', 'Device folder', 'A path in shared storage', () => this.openDeviceFolder()) : null,
        card('zip', 'Import .zip', 'Unpack a zipped project', () => $('#zip-input').click(), isOpfsSupported()),
        card('upload', 'Import folder', 'Copy a folder into the app', () => $('#folder-input').click(), isOpfsSupported()),
        card('git', 'Clone repository', 'From an https git URL', () => this.cloneRepo(), isOpfsSupported()),
        card('file', 'Open files', 'Edit single files without a project', () => this.openLooseFiles()),
        card('newFile', 'Scratch file', 'An unsaved buffer to try things', () => { this.ws.newUntitled({ name: 'scratch.js', langId: 'javascript' }); this.closeProjectModal(); })),
      h('h3', 'Recent projects'), list,
    );
    listProjects().then((projects) => {
      this.knownProjects = projects;
      list.textContent = '';
      if (!projects.length) { list.append(h('div.panel-note', 'No projects yet.')); return; }
      for (const p of projects) {
        const kind = { browser: 'In-app storage', folder: 'Folder on this device', device: `Device: ${p.rootPath}` }[p.kind];
        list.append(h('div.project-row',
          h('button.pr-main', { type: 'button', onclick: async () => { if (p.kind === 'folder' && (await permissionState(p)) !== 'granted') await this.reconnect(p); else await this.openProject(p); this.closeProjectModal(); } },
            h('span.pr-name', p.name), h('span.pr-meta', `${kind}${p.lastOpened ? ` · ${formatTime(p.lastOpened)}` : ''}`)),
          h('button.icon-btn.small', { type: 'button', 'aria-label': `Remove ${p.name}`, title: p.kind === 'browser' ? 'Delete project' : 'Forget', icon: 'trash', onclick: async () => {
            if (p.kind === 'browser') {
              if (!(await confirm(`Delete “${p.name}”?`, 'This permanently deletes the project and all its files from this device. Export it as .zip first if you need a copy.', 'Delete', 'danger'))) return;
              if (this.project && this.project.meta.id === p.id) { await this.ws.closeAll({ force: true }); this.project = null; await this.ws.setProject(null); this.tree.reset(); }
              await deleteBrowserProject(p.name);
            } else {
              await forgetProject(p.id);
            }
            const fresh = this.projectPickerView();
            view.replaceWith(fresh);
          } })));
      }
    });
    return view;
  }

  showProjectModal() {
    this.projectModal = showModal('Projects', this.projectPickerView(), { className: 'wide', onClose: () => { this.projectModal = null; } });
  }

  closeProjectModal() {
    if (this.projectModal) { this.projectModal.close(); this.projectModal = null; }
  }

  async openLooseFiles() {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        for (const fh of handles) {
          const f = await fh.getFile();
          this.ws.openLooseFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), fileHandle: fh, lastModified: f.lastModified });
        }
        this.closeProjectModal();
      } catch (err) {
        if (err.name !== 'AbortError') toast(err.message, 'error');
      }
      return;
    }
    const input = $('#file-input');
    input.onchange = async () => {
      for (const f of input.files) this.ws.openLooseFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), lastModified: f.lastModified });
      input.value = '';
      this.closeProjectModal();
      toast('Opened as copies: Save downloads the edited file.', 'info');
    };
    input.click();
  }

  // ---- file actions ---------------------------------------------------------------------

  fileActions() {
    const fsOf = () => (this.project ? this.project.fs : null);
    const need = () => { if (!this.project) { toast('Open or create a project first.', 'warn'); return null; } return this.project.fs; };
    const afterChange = (dir) => { this.fileCache = null; return this.tree.refresh(dir != null ? [dir] : null); };
    const validatePath = (v) => (v.split('/').some((seg) => validateName(seg)) ? 'Names can\'t be empty or contain \\ : * ? " < > |' : null);
    return {
      newFile: async (dir) => {
        const fs = need(); if (!fs) return;
        const name = await prompt({ title: dir ? `New file in ${dir}/` : 'New file', label: 'File name (folders allowed: css/site.css)', placeholder: 'app.js', validate: validatePath });
        if (!name) return;
        const path = join(dir, name);
        try {
          if (dirname(path)) await fs.createDir(dirname(path), { recursive: true });
          await fs.createFile(path);
        } catch (err) { toast(err.code === 'EEXIST' ? `${path} already exists.` : err.message, 'error'); return; }
        await afterChange();
        await this.tree.reveal(path);
        await this.ws.openPath(path);
        this.layout.closeDrawer();
      },
      newFolder: async (dir) => {
        const fs = need(); if (!fs) return;
        const name = await prompt({ title: 'New folder', label: 'Folder name', validate: validatePath, selectBase: false });
        if (!name) return;
        const path = join(dir, name);
        try { await fs.createDir(path, { recursive: true }); } catch (err) { toast(err.message, 'error'); return; }
        this.tree.expanded.add(path);
        await afterChange();
      },
      rename: async (path, kind) => {
        const fs = fsOf(); if (!fs) return;
        const name = await prompt({ title: `Rename ${kind === 'directory' ? 'folder' : 'file'}`, label: 'New name', value: basename(path), validate: validateName });
        if (!name || name === basename(path)) return;
        const to = join(dirname(path), name);
        try { await fs.rename(path, to); } catch (err) { toast(err.code === 'EEXIST' ? `${to} already exists.` : err.message, 'error'); return; }
        this.ws.onPathRenamed(path, to);
        if (this.tree.expanded.has(path)) { this.tree.expanded.delete(path); this.tree.expanded.add(to); }
        await afterChange(dirname(path));
      },
      /** Drag and drop in the file tree: `path` goes into folder `toDir` ('' = project root). */
      move: async (path, kind, toDir) => {
        const fs = fsOf(); if (!fs) return;
        const to = join(toDir, basename(path));
        if (to === path) return;
        if (kind === 'directory' && (toDir === path || toDir.startsWith(path + '/'))) return;
        try { await fs.rename(path, to); } catch (err) { toast(err.code === 'EEXIST' ? `${to} already exists.` : err.message, 'error'); return; }
        this.ws.onPathRenamed(path, to);
        const moved = (p) => (p === path || p.startsWith(path + '/') ? to + p.slice(path.length) : p);
        this.tree.expanded = new Set([...this.tree.expanded].map(moved));
        if (toDir) this.tree.expanded.add(toDir);
        if (this.project) kv.set(`expanded:${this.project.meta.id}`, [...this.tree.expanded]).catch(() => {});
        await afterChange();
        await this.tree.reveal(to);
        toast(`Moved ${basename(path)} to ${toDir ? `${toDir}/` : 'the project root'}`, 'success');
        if (this.activePanel === 'git') this.gitLater();
      },
      duplicate: async (path) => {
        const fs = fsOf(); if (!fs) return;
        const base = basename(path);
        const dot = base.lastIndexOf('.');
        let i = 1, to;
        do {
          const suffix = i === 1 ? ' copy' : ` copy ${i}`;
          to = join(dirname(path), dot > 0 ? `${base.slice(0, dot)}${suffix}${base.slice(dot)}` : `${base}${suffix}`);
          i++;
        } while (await fs.exists(to));
        try { await fs.copy(path, to); } catch (err) { toast(err.message, 'error'); return; }
        await afterChange(dirname(path));
      },
      remove: async (path, kind) => {
        const fs = fsOf(); if (!fs) return;
        const ok = await confirm(`Delete ${basename(path)}?`, kind === 'directory' ? 'The folder and everything inside it will be deleted.' : 'The file will be deleted. Local history keeps earlier saved versions for a while.', 'Delete', 'danger');
        if (!ok) return;
        try { await fs.delete(path, { recursive: true }); } catch (err) { toast(err.message, 'error'); return; }
        await this.ws.onPathDeleted(path);
        await afterChange(dirname(path));
        if (this.activePanel === 'git') this.gitLater();
      },
      copyPath: (path) => this.copyText(path),
      download: async (path) => {
        const fs = fsOf(); if (!fs) return;
        const doc = this.ws.allDocs().find((d) => d.path === path);
        const bytes = doc && doc.dirty ? new TextEncoder().encode(this.ws.textOf(doc.id)) : (await fs.readBytes(path)).bytes;
        this.downloadBytes(bytes, basename(path));
      },
      upload: (dir) => {
        const fs = need(); if (!fs) return;
        const input = $('#file-input');
        input.onchange = async () => {
          for (const f of input.files) await fs.writeBytes(join(dir, f.name), new Uint8Array(await f.arrayBuffer()));
          toast(`Added ${input.files.length} file(s).`, 'success');
          input.value = '';
          if (dir) this.tree.expanded.add(dir);
          await afterChange(dir);
        };
        input.click();
      },
      openToSide: async (path) => {
        this.split({ copyActive: false });
        await this.ws.openPath(path, { paneIndex: 1 });
        this.layout.closeDrawer();
      },
    };
  }

  filesMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    popupMenu([
      { label: 'Collapse all folders', run: () => this.tree.collapseAll() },
      { label: 'Upload files…', icon: 'upload', run: () => this.actions.upload('') },
      { label: 'Export project as .zip', icon: 'download', run: () => this.exportZip(), disabled: !this.project },
      '-',
      { label: 'Switch project…', icon: 'folder', run: () => this.showProjectModal() },
      { label: 'New project…', icon: 'plus', run: () => this.newBrowserProject() },
    ], { x: r.left, y: r.bottom });
  }

  async projectFiles() {
    if (!this.project) return [];
    if (this.fileCache) return this.fileCache;
    const fs = this.project.fs;
    let rules = new IgnoreRules(ignoreNames(this.settings));
    const gitignores = new Map();
    // Load .gitignore files as we walk so nested ones apply below their folder.
    const files = [];
    const queue = [''];
    while (queue.length && files.length < 20000) {
      const dir = queue.shift();
      let entries;
      try { entries = await fs.list(dir); } catch { continue; }
      const gi = entries.find((x) => x.name === '.gitignore' && x.kind === 'file');
      if (gi && !gitignores.has(dir)) {
        try { rules = rules.withGitignore(dir, await fs.readText(gi.path)); gitignores.set(dir, true); } catch { /* ignore */ }
      }
      for (const en of entries) {
        if (rules.isIgnored(en.path, en.kind === 'directory')) continue;
        if (en.kind === 'directory') queue.push(en.path); else files.push(en.path);
      }
    }
    this.fileCache = files;
    setTimeout(() => { this.fileCache = null; }, 30000);
    return files;
  }

  async readTextForSearch(path) {
    const doc = this.ws.allDocs().find((d) => d.path === path);
    if (doc) return this.ws.textOf(doc.id);
    const st = await this.project.fs.stat(path);
    if (!st || st.size > 1024 * 1024) return null; // skip big files
    const { bytes } = await this.project.fs.readBytes(path);
    if (bytes.subarray(0, 4000).includes(0)) return null; // binary
    return new TextDecoder().decode(bytes);
  }

  async readForPreview(path) {
    const doc = this.ws.allDocs().find((d) => d.path === path || (!this.project && d.name === path));
    if (doc) return { text: this.ws.textOf(doc.id) };
    if (!this.project) return null;
    try {
      const { bytes } = await this.project.fs.readBytes(path);
      return /\.(html?|css|m?js|json|md|svg|txt|xml|csv)$/i.test(path) ? { text: new TextDecoder().decode(bytes) } : { bytes };
    } catch {
      return null;
    }
  }

  downloadBytes(bytes, name, type = 'application/octet-stream') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type }));
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  toast(message, kind, duration) {
    toast(message, kind, duration);
  }

  async copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied.', 'success', 1000); } catch { toast(text, 'info'); }
  }

  // ---- run / preview / format -------------------------------------------------------------

  async runActive() {
    const doc = this.ws.activeDoc;
    if (!doc) { toast('Open a file to run it.', 'warn'); return; }
    const id = doc.lang.id;
    if (id === 'javascript') return this.runJs(doc);
    if (id === 'html' || id === 'markdown') {
      if (doc.kind !== 'project' && this.project == null) { this.preview.open(doc.name); return; }
      return this.preview.open(doc.path || doc.name);
    }
    if (id === 'css' || (id !== 'javascript' && /\.(m?js)$/.test(doc.name))) {
      const target = (this.preview.target && this.preview.target.path) || (doc.path && join(dirname(doc.path), 'index.html'));
      if (target && (await this.readForPreview(target))) return this.preview.open(target);
    }
    if (id === 'typescript' || id === 'tsx' || id === 'jsx') {
      toast(`${doc.lang.name} needs a compile step, which this offline build doesn't include. Plain .js files run directly.`, 'warn', 6000);
      return;
    }
    if (id === 'python') {
      toast('Running Python isn\'t available in the web build (it needs a bundled interpreter). JavaScript, HTML and Markdown run offline.', 'warn', 6000);
      return;
    }
    toast(`No runner for ${doc.lang.name}. Run works for .js, and previews .html / .md.`, 'warn');
  }

  runJs(doc) {
    const code = this.ws.textOf(doc.id);
    const filename = doc.path || doc.name;
    this.bottom.show('console');
    this.bottom.clear();
    this.bottom.system(`▶ ${filename}  (time limit ${this.settings.runTimeLimit}s)`);
    $('#btn-run').classList.add('running');
    this.bottom.setRunning(true);
    this.lastRun = doc.id;
    this.runner.run({
      code, filename,
      stdin: this.bottom.stdin,
      timeLimit: this.settings.runTimeLimit,
      onOutput: (e) => this.bottom.log(e),
      onClear: () => this.bottom.clear(),
      onInput: (q) => this.bottom.requestInput(q),
      onSyntaxError: () => {
        const st = this.ws.stateOf(doc.id);
        const diag = st && syntaxDiagnostics(st)[0];
        if (diag) {
          const line = st.doc.lineAt(diag.from);
          this.bottom.log({ level: 'error', text: `    near ${filename}:${line.number}:${diag.from - line.from + 1}` });
        }
      },
      onExit: (status, ms) => {
        $('#btn-run').classList.remove('running');
        this.bottom.setRunning(false);
        const msg = { done: `✓ Finished in ${ms} ms`, stopped: `■ Stopped after ${ms} ms`, timeout: `⏱ Stopped: time limit of ${this.settings.runTimeLimit}s reached (infinite loop?)`, error: '✖ Could not run' }[status];
        this.bottom.log({ level: status === 'done' ? 'system' : 'warn', text: msg });
      },
    });
  }

  async formatDoc(docId = this.ws.activeDoc?.id, { quiet = false } = {}) {
    const doc = this.ws.docs.get(docId);
    if (!doc) return;
    if (!canFormat(doc.lang.id)) { if (!quiet) toast(`No formatter for ${doc.lang.name}.`, 'warn'); return; }
    const state = this.ws.stateOf(doc.id);
    const text = state.doc.toString();
    const res = await formatText({ text, langId: doc.lang.id, cursorOffset: state.selection.main.head, tabWidth: doc.indent.indentSize, useTabs: !doc.indent.insertSpaces });
    if (!res.ok) { if (!quiet) toast(`Format failed: ${res.error.split('\n')[0]}`, 'error', 6000); return; }
    const ch = minimalChange(text, res.formatted);
    if (!ch) { if (!quiet) toast('Already formatted.', 'info', 1200); return; }
    this.ws.dispatchToDoc(doc.id, { changes: ch, selection: { anchor: Math.min(res.cursorOffset, res.formatted.length) }, userEvent: 'input.format', scrollIntoView: true });
    if (!quiet) toast('Formatted.', 'success', 1000);
  }

  resolveConsolePath(p) {
    const docs = this.ws.allDocs();
    const exact = docs.find((d) => d.path === p || d.name === p);
    if (exact) return exact.path || exact.name;
    if (this.project && this.fileCache && this.fileCache.includes(p)) return p;
    return null;
  }

  async openAt(path, line, col = 1, docId = null) {
    let doc = docId != null ? this.ws.docs.get(docId) : this.ws.allDocs().find((d) => d.path === path || d.name === path);
    if (!doc && this.project) doc = await this.ws.openPath(path, { line, col });
    if (!doc) return;
    const pane = this.ws.paneFor(doc.id);
    if (pane) this.ws.showDoc(pane.index, doc.id, { focus: false });
    this.ws.revealLine(doc.id, line, col);
  }

  compareWithDisk(doc, diskText = doc.conflict ? doc.conflict.diskText : doc.saved.toString()) {
    let m = null;
    m = showDiff(`${doc.name}: disk version → your version`, diskText, this.ws.textOf(doc.id), [
      h('button.btn', { type: 'button', onclick: () => { this.ws.resolveConflict(doc.id, 'disk'); m.close(); } }, 'Use disk version'),
      h('button.btn.btn-primary', { type: 'button', onclick: () => { if (doc.conflict) this.ws.resolveConflict(doc.id, 'mine'); m.close(); } }, 'Keep mine'),
    ]);
  }

  // ---- problems --------------------------------------------------------------------------

  problemsLater() {
    clearTimeout(this._problemsTimer);
    this._problemsTimer = setTimeout(() => this.updateProblems(), 250);
  }

  updateProblems() {
    const items = [];
    for (const doc of this.ws.allDocs()) {
      const st = this.ws.stateOf(doc.id);
      if (!st) continue;
      forEachDiagnostic(st, (d, from) => {
        const line = st.doc.lineAt(Math.min(from, st.doc.length));
        items.push({ docId: doc.id, path: doc.path || doc.name, name: doc.name, line: line.number, col: from - line.from + 1, severity: d.severity, message: d.message });
      });
    }
    this.problemCounts = { errors: items.filter((i) => i.severity === 'error').length, warnings: items.filter((i) => i.severity === 'warning').length };
    if (this.bottom.visible && this.bottom.tab === 'problems') this.bottom.renderProblems(items);
    else {
      const c = $('#problems-count');
      c.textContent = String(items.length);
      c.classList.toggle('hidden', !items.length);
    }
    renderStatus(this);
  }

  // ---- gestures ------------------------------------------------------------------------------

  runGesture(key, view, paneIndex) {
    const action = this.settings.gestureMap[key];
    if (!action || action === 'none') return;
    if (this.ws.activePane !== paneIndex) this.ws.setActivePane(paneIndex);
    const label = this.run(action, view);
    if (label) {
      haptic(this.settings, 12);
      if (action === 'deleteLine') { this.hint('Line deleted · Undo brings it back'); return; }
      this.hint(typeof label === 'string' ? label : GESTURE_ACTIONS[action]);
    } else {
      this.hint(`${GESTURE_ACTIONS[action].split(' (')[0]} — nothing to do`, true);
    }
  }

  onPinch(ev) {
    if (ev.type === 'pinch-start') this._pinchBase = this.settings.fontSize;
    const size = Math.round(Math.max(8, Math.min(40, (this._pinchBase || this.settings.fontSize) * ev.scale)));
    if (ev.type === 'pinch-end') {
      this.updateSettings({ fontSize: size });
      this.hint(`Font ${size}px`);
      return;
    }
    if (size !== this._pinchSize) {
      this._pinchSize = size;
      this.applyFont(size);
      this.hint(`Font ${size}px`);
    }
  }

  /** Several cursors are easy to miss on a phone: say how to get back to one. */
  multiHint(label) {
    if (label && /cursors$/.test(label)) this.hint(`${label} — tap the text for one`);
    return label;
  }

  hint(text, muted = false) {
    if (!this.settings.gestureHints) return;
    const el = $('#gesture-hint');
    el.textContent = text;
    el.classList.toggle('muted', muted);
    el.classList.add('show');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => el.classList.remove('show'), 750);
  }

  // ---- commands --------------------------------------------------------------------------------

  /** Runs a named command; returns a truthy label when something happened. */
  run(name, viewArg = null) {
    const view = viewArg || (this.ws.activeDoc ? this.ws.view : null);
    const cmd = this.commands()[name];
    if (!cmd) { console.warn('unknown command', name); return null; }
    try {
      const r = cmd.run(view);
      if (r && typeof r.then === 'function') { r.catch((err) => toast(err.message, 'error')); return cmd.label; }
      return r === undefined ? cmd.label : r;
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }
  }

  commands() {
    if (this._commands) return this._commands;
    const ws = this.ws;
    const docOr = (fn) => () => { const d = ws.activeDoc; return d ? fn(d) : null; };
    const tabStep = (delta) => () => {
      const p = ws.pane;
      if (!p || p.tabs.length < 2) return null;
      const i = p.tabs.indexOf(p.activeId);
      ws.showDoc(p.index, p.tabs[(i + delta + p.tabs.length) % p.tabs.length]);
      return 'Tab';
    };
    const zoom = (d) => () => { this.updateSettings({ fontSize: d === 0 ? DEFAULTS.fontSize : this.settings.fontSize + d }); return `Font ${this.settings.fontSize}px`; };
    const c = {
      // editing (keys bar + gestures)
      autocomplete: { label: 'Autocomplete', run: (v) => E.autocomplete(v) },
      dismissOrDeleteWord: { label: 'Close suggestions / delete word', run: (v) => E.dismissOrDeleteWord(v) },
      undo: { label: 'Undo', key: 'Ctrl+Z', run: (v) => E.undo(v) },
      redo: { label: 'Redo', key: 'Ctrl+Y', run: (v) => E.redo(v) },
      tab: { label: 'Tab / indent', run: (v) => E.tabKey(v) },
      indent: { label: 'Indent line', key: 'Ctrl+]', run: (v) => E.indent(v) },
      outdent: { label: 'Outdent line', key: 'Ctrl+[', run: (v) => E.outdent(v) },
      toggleComment: { label: 'Toggle comment', key: 'Ctrl+/', run: (v) => E.toggleComment(v) },
      duplicateLine: { label: 'Duplicate line', key: 'Shift+Alt+↓', run: (v) => E.duplicateLine(v) },
      lineUp: { label: 'Move line up', key: 'Alt+↑', run: (v) => E.lineUp(v) },
      lineDown: { label: 'Move line down', key: 'Alt+↓', run: (v) => E.lineDown(v) },
      deleteLine: { label: 'Delete line', key: 'Ctrl+Shift+K', run: (v) => E.deleteLine(v) },
      newlineBelow: { label: 'Insert line below', key: 'Ctrl+Enter', run: (v) => E.newlineBelow(v) },
      newlineAbove: { label: 'Insert line above', key: 'Ctrl+Alt+Enter', run: (v) => E.newlineAbove(v) },
      copyLineUp: { label: 'Copy line up', key: 'Shift+Alt+↑', run: (v) => E.copyLineUp(v) },
      joinLines: { label: 'Join with the next line', run: (v) => E.joinLines(v) },
      completeStatement: { label: 'Complete statement (add ; and new line)', key: 'Ctrl+Shift+Enter', run: (v) => completeStatement(v) },
      addCursorDown: { label: 'Add cursor on the line below', key: 'Ctrl+Alt+↓', run: (v) => this.multiHint(E.addCursorDown(v)) },
      addCursorUp: { label: 'Add cursor on the line above', key: 'Ctrl+Alt+↑', run: (v) => this.multiHint(E.addCursorUp(v)) },
      selectNext: { label: 'Select next occurrence', key: 'Ctrl+D', run: (v) => this.multiHint(E.selectNext(v)) },
      cursorsOnLines: { label: 'Cursor on each selected line', key: 'Shift+Alt+I', run: (v) => this.multiHint(E.cursorsOnLines(v) || (toast('Select several lines first (drag down the line numbers).', 'info'), null)) },
      selectAllMatches: { label: 'Select all occurrences', key: 'Ctrl+Shift+L', run: (v) => this.multiHint(E.selectAllMatches(v)) },
      escape: { label: 'Escape (close list / panel, one cursor)', key: 'Esc', run: (v) => E.escape(v) || this.escapeApp() },
      backspace: { label: 'Backspace', run: (v) => E.backspace(v) },
      deleteForward: { label: 'Delete', key: 'Del', run: (v) => E.deleteForward(v) },
      selectAll: { label: 'Select all', key: 'Ctrl+A', run: (v) => E.selectAll(v) },
      selectLine: { label: 'Select line', key: 'Ctrl+L', run: (v) => E.selectLineCmd(v) },
      selectWord: { label: 'Select word', run: (v) => E.selectWord(v) },
      cut: { label: 'Cut', key: 'Ctrl+X', run: (v) => this.clipboard('cut', v) },
      copy: { label: 'Copy', key: 'Ctrl+C', run: (v) => this.clipboard('copy', v) },
      paste: { label: 'Paste', key: 'Ctrl+V', run: (v) => this.clipboard('paste', v) },
      lineStart: { label: 'Line start', key: 'Home', run: (v) => E.goLineStart(v) },
      lineEnd: { label: 'Line end', key: 'End', run: (v) => E.goLineEnd(v) },
      docStart: { label: 'Start of the file', key: 'Ctrl+Home', run: (v) => E.goDocStart(v) },
      docEnd: { label: 'End of the file', key: 'Ctrl+End', run: (v) => E.goDocEnd(v) },
      pageUp: { label: 'Page up', key: 'PgUp', run: (v) => E.pageUp(v) },
      pageDown: { label: 'Page down', key: 'PgDn', run: (v) => E.pageDown(v) },
      matchingBracket: { label: 'Go to matching bracket', key: 'Ctrl+Shift+\\', run: (v) => E.matchingBracket(v) },
      expandSelection: { label: 'Expand selection', key: 'Alt+Shift+→', run: (v) => E.expandSelection(v) },
      shrinkSelection: { label: 'Shrink selection', key: 'Alt+Shift+←', run: (v) => E.shrinkSelection(v) },
      find: { label: 'Find / replace in file', key: 'Ctrl+F', run: (v) => E.find(v) },
      hideKeyboard: { label: 'Hide keyboard', run: (v) => E.hideKeyboard(v) },
      foldAll: { label: 'Fold all', run: (v) => (v && foldAll(v) ? 'Folded' : null) },
      unfoldAll: { label: 'Unfold all', run: (v) => (v && unfoldAll(v) ? 'Unfolded' : null) },
      reindent: { label: 'Reindent file', run: (v) => { if (!v) return null; v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); indentSelection(v); return 'Reindented'; } },
      format: { label: 'Format document (Prettier)', key: 'Shift+Alt+F', run: () => this.formatDoc() },
      // files
      save: { label: 'Save', key: 'Ctrl+S', run: () => ws.save() },
      saveAs: { label: 'Save as…', run: () => ws.save(undefined, { saveAs: true }) },
      saveAll: { label: 'Save all', key: 'Ctrl+Shift+S', run: () => ws.saveAll() },
      newFile: { label: 'New file…', run: () => (this.project ? this.actions.newFile(ws.activeDoc && ws.activeDoc.path ? dirname(ws.activeDoc.path) : '') : ws.newUntitled()) },
      newFolder: { label: 'New folder…', run: () => this.actions.newFolder('') },
      newUntitled: { label: 'New untitled file', run: () => ws.newUntitled() },
      openFiles: { label: 'Open files (outside a project)…', run: () => this.openLooseFiles() },
      closeTab: { label: 'Close tab', key: 'Alt+W', run: docOr((d) => ws.closeTab(ws.activePane, d.id)) },
      closeAll: { label: 'Close all tabs', run: () => ws.closeAll() },
      quickOpen: { label: 'Go to file…', key: 'Ctrl+P', run: () => this.palette.open('') },
      revealActive: { label: 'Reveal active file in tree', run: docOr((d) => d.path && this.revealInTree(d.path)) },
      toggleWrap: { label: 'Toggle soft wrap', run: docOr((d) => { ws.setWrap(d.id, !d.wrap); return d.wrap ? 'Wrap on' : 'Wrap off'; }) },
      toggleLock: { label: 'Toggle read-only lock', run: docOr((d) => { ws.setLocked(d.id, !d.locked); return d.locked ? 'Locked' : 'Unlocked'; }) },
      changeLanguage: { label: 'Change language mode…', run: () => this.pickLanguage() },
      compareSaved: { label: 'Compare with saved version', run: docOr((d) => showDiff(`${d.name}: saved → current`, d.saved.toString(), ws.textOf(d.id))) },
      // projects
      switchProject: { label: 'Switch project…', run: () => this.showProjectModal() },
      newProject: { label: 'New project…', run: () => this.newBrowserProject() },
      openFolder: { label: 'Open folder…', run: () => (isFolderPickerSupported() ? this.openFolder() : toast('This browser cannot open device folders; use a project or Import.', 'warn')) },
      importZip: { label: 'Import .zip as project…', run: () => $('#zip-input').click() },
      exportZip: { label: 'Export project as .zip', run: () => this.exportZip() },
      cloneRepo: { label: 'Git: clone repository…', run: () => this.cloneRepo() },
      // navigation & view
      commandPalette: { label: 'Command palette', key: 'Ctrl+Shift+P', run: () => { this.palette.open('>'); return 'Command palette'; } },
      goToLine: { label: 'Go to line…', key: 'Ctrl+G', run: () => this.palette.open(':') },
      goToSymbol: { label: 'Go to symbol in file…', key: 'Ctrl+Shift+O', run: () => this.palette.open('@') },
      navigateBack: { label: 'Go back', key: 'Ctrl+Alt+-', run: () => ws.navigate(-1) },
      navigateForward: { label: 'Go forward', key: 'Ctrl+Shift+-', run: () => ws.navigate(1) },
      nextTab: { label: 'Next tab', key: 'Ctrl+Tab', run: tabStep(1) },
      prevTab: { label: 'Previous tab', key: 'Ctrl+Shift+Tab', run: tabStep(-1) },
      toggleSidebar: { label: 'Toggle sidebar', key: 'Ctrl+B', run: () => this.layout.toggleSidebar() },
      showFiles: { label: 'Show files', run: () => this.showPanel('files') },
      searchProject: { label: 'Search in project', key: 'Ctrl+Shift+F', run: () => this.showPanel('search', { focus: true }) },
      showOutline: { label: 'Show outline', run: () => this.showPanel('outline') },
      showGit: { label: 'Show source control', run: () => this.showPanel('git') },
      showHistory: { label: 'Show local history', run: () => this.showPanel('history') },
      showSettings: { label: 'Settings', run: () => this.showPanel('settings') },
      toggleConsole: { label: 'Toggle console', key: 'Ctrl+J', run: () => this.bottom.toggle('console') },
      showProblems: { label: 'Show problems', run: () => this.bottom.show('problems') },
      split: { label: 'Split editor', key: 'Ctrl+\\', run: () => this.toggleSplit() },
      focusOtherPane: { label: 'Focus other pane', run: () => { const o = ws.activePane === 0 ? 1 : 0; if (ws.panes[o] && ws.panes[o].visible !== false) { ws.setActivePane(o); ws.panes[o].view.focus(); } } },
      zoomIn: { label: 'Zoom in (font)', key: 'Ctrl+=', run: zoom(1) },
      zoomOut: { label: 'Zoom out (font)', key: 'Ctrl+-', run: zoom(-1) },
      zoomReset: { label: 'Reset font size', key: 'Ctrl+0', run: zoom(0) },
      toggleTheme: { label: 'Toggle dark / light theme', run: () => this.updateSettings({ theme: document.documentElement.classList.contains('theme-dark') ? 'light' : 'dark' }) },
      shortcuts: { label: 'Keyboard shortcuts', key: 'F1', run: () => this.showShortcuts() },
      gestureGuide: { label: 'Touch gestures guide', run: () => this.showGestureGuide() },
      // run
      run: { label: 'Run file / preview', key: 'F5', run: () => (this.runner.running ? this.runner.stop('stopped') : this.runActive()) },
      stop: { label: 'Stop running script', run: () => this.runner.stop('stopped') },
      preview: { label: 'Preview HTML / Markdown', run: docOr((d) => this.preview.open(d.path || d.name)) },
      navigatePrevProblem: { label: 'Show problems panel', run: () => this.bottom.show('problems') },
    };
    this._commands = c;
    return c;
  }

  commandList() {
    const hidden = new Set(['tab', 'backspace', 'dismissOrDeleteWord', 'navigatePrevProblem']);
    return Object.entries(this.commands()).filter(([id]) => !hidden.has(id)).map(([id, c]) => ({ id, label: c.label, key: c.key, run: () => this.run(id) }));
  }

  symbolItems() {
    const d = this.ws.activeDoc;
    if (!d) return [];
    return flattenSymbols(symbolsFor(this.ws.view.state)).map((s) => ({ label: s.name, detail: `${s.kind} · line ${s.line}`, run: () => this.ws.revealPos(d.id, s.from) }));
  }

  async pickLanguage() {
    const d = this.ws.activeDoc;
    if (!d) return;
    const items = [...LANGUAGES, PLAIN].map((l) => ({ label: l.name, detail: l.ext.map((e) => `.${e}`).join(' '), id: l.id }));
    const pick = await this.palette.pick(items, { placeholder: 'Select language mode' });
    if (pick) this.ws.setLanguage(d.id, pick.id);
  }

  editorContextMenu(at) {
    const v = this.ws.view;
    const hasSel = !v.state.selection.main.empty;
    popupMenu([
      { label: 'Cut', hint: 'Ctrl+X', disabled: !hasSel || v.state.readOnly, run: async () => { const r = v.state.selection.main; await navigator.clipboard.writeText(v.state.sliceDoc(r.from, r.to)).catch(() => {}); v.dispatch(v.state.replaceSelection(''), { userEvent: 'delete.cut' }); } },
      { label: 'Copy', hint: 'Ctrl+C', disabled: !hasSel, run: () => { const r = v.state.selection.main; navigator.clipboard.writeText(v.state.sliceDoc(r.from, r.to)).catch(() => {}); } },
      { label: 'Paste', hint: 'Ctrl+V', disabled: v.state.readOnly, run: async () => { try { const t = await navigator.clipboard.readText(); v.dispatch(v.state.replaceSelection(t), { userEvent: 'input.paste' }); } catch { toast('Paste with Ctrl+V (clipboard access was blocked).', 'warn'); } } },
      '-',
      { label: 'Expand selection', hint: 'Alt+Shift+→', run: () => this.run('expandSelection') },
      { label: 'Toggle comment', hint: 'Ctrl+/', run: () => this.run('toggleComment') },
      { label: 'Format document', hint: 'Shift+Alt+F', run: () => this.run('format') },
      { label: 'Go to symbol…', hint: 'Ctrl+Shift+O', run: () => this.run('goToSymbol') },
      '-',
      { label: 'Command palette', hint: 'Ctrl+Shift+P', run: () => this.run('commandPalette') },
    ], at);
  }

  // ---- shortcuts -----------------------------------------------------------------------------

  bindShortcuts() {
    const map = [
      ['Mod-s', 'save'], ['Mod-Shift-s', 'saveAll'], ['Mod-p', 'quickOpen'], ['Mod-Shift-p', 'commandPalette'], ['F1', 'commandPalette'],
      ['Mod-g', 'goToLine'], ['Mod-Shift-o', 'goToSymbol'], ['F5', 'run'], ['Mod-Shift-f', 'searchProject'],
      ['Mod-b', 'toggleSidebar'], ['Mod-\\', 'split'], ['Alt-Shift-ArrowRight', 'expandSelection'], ['Alt-Shift-ArrowLeft', 'shrinkSelection'],
      ['Alt-Shift-f', 'format'], ['Mod-=', 'zoomIn'], ['Mod-+', 'zoomIn'], ['Mod--', 'zoomOut'], ['Mod-0', 'zoomReset'],
      ['Ctrl-Tab', 'nextTab'], ['Ctrl-Shift-Tab', 'prevTab'], ['Alt-PageDown', 'nextTab'], ['Alt-PageUp', 'prevTab'],
      ['Alt-w', 'closeTab'], ['Ctrl-Alt--', 'navigateBack'], ['Ctrl-Shift--', 'navigateForward'], ['Mod-j', 'toggleConsole'],
      ['Mod-Shift-e', 'showFiles'], ['Mod-Shift-g', 'showGit'],
      // Editor-only, but listed here because on Android the editor sees
      // Enter without its modifiers (CodeMirror re-dispatches it).
      ['Mod-Enter', 'newlineBelow'], ['Mod-Shift-Enter', 'completeStatement'], ['Mod-Alt-Enter', 'newlineAbove'],
    ].map(([k, cmd]) => [parseKey(k), cmd]);
    this.shortcutTable = map;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeMenus();
        if (this.palette.isOpen) { this.palette.close(); return; }
        if (this.layout.compact && $('#app').classList.contains('drawer-open')) { this.layout.closeDrawer(); return; }
        if ($('#bottom-panel').classList.contains('maximized')) { $('#bottom-panel').classList.remove('maximized'); this.bottom.renderActions(); return; }
      }
      if (isModalOpen()) return;
      // In a plain text field (commit message, search box…) only the global
      // shortcuts apply; e.g. Ctrl+Enter there means "commit", not "run".
      const t = e.target;
      const inField = t && t.closest && t.closest('input, textarea, select') && !t.closest('.cm-editor');
      for (const [spec, cmd] of map) {
        if (keyMatches(e, spec)) {
          if (inField && !FIELD_SAFE.has(cmd)) return;
          if (EDITOR_ONLY.has(cmd) && !(t && t.closest && t.closest('.cm-editor'))) return;
          e.preventDefault();
          e.stopPropagation();
          if (this.palette.isOpen && cmd !== 'commandPalette' && cmd !== 'quickOpen') this.palette.close();
          this.run(cmd);
          return;
        }
      }
    }, true);
  }

  showShortcuts() {
    const rows = this.shortcutTable.map(([spec, cmd]) => [spec.label, this.commands()[cmd].label]);
    rows.push(['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+F', 'Find & replace'], ['Ctrl+/', 'Toggle comment'], ['Alt+↑ / Alt+↓', 'Move line'],
      ['Shift+Alt+↓', 'Duplicate line'], ['Ctrl+Shift+K', 'Delete line'], ['Ctrl+] / Ctrl+[', 'Indent / outdent'], ['Ctrl+Space', 'Autocomplete'], ['Tab', 'Accept suggestion / expand Emmet'],
      ['Ctrl+D', 'Select next occurrence'], ['Alt+click / drag', 'Multiple cursors / column select'], ['Ctrl+Shift+[ / ]', 'Fold / unfold']);
    showModal('Keyboard shortcuts', h('table.help-table', h('tbody', rows.map(([k, l]) => h('tr', h('td', h('kbd', k)), h('td', l))))), { className: 'wide' });
  }

  showGestureGuide() {
    showModal('Touch gestures', h('div', h('p.modal-message', 'Gestures work on the code itself. Change them in Settings → Touch & gestures.'), gestureCheatSheet(this)));
  }

  async storageInfo() {
    try {
      const est = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      return `Using ${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1048576 / 1024).toFixed(1)} GB · ${persisted ? 'protected from automatic cleanup' : 'may be cleared by the browser if space runs low — export important projects'}`;
    } catch {
      return 'Storage information unavailable.';
    }
  }

  // ---- titlebar & lifecycle --------------------------------------------------------------------

  bindTitlebar() {
    $('#btn-sidebar').addEventListener('click', () => this.layout.toggleSidebar());
    $('#btn-project').addEventListener('click', () => this.showProjectModal());
    $('#btn-back').addEventListener('click', () => this.run('navigateBack'));
    $('#btn-forward').addEventListener('click', () => this.run('navigateForward'));
    // pointerdown + preventDefault keeps focus (and the soft keyboard) in the editor.
    for (const [id, cmd] of [['#btn-undo', 'undo'], ['#btn-redo', 'redo'], ['#btn-save', 'save']]) {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.run(cmd));
    }
    $('#btn-split').addEventListener('click', () => this.run('split'));
    $('#btn-palette').addEventListener('click', () => this.palette.open('>'));
    $('#btn-run').addEventListener('click', () => this.run('run'));
    $('#zip-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.importZip(f); });
    $('#folder-input').addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; this.importFolderFiles(files); });
  }

  bindLifecycle() {
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        this.recovery.flushAll();
        this.ws.saveSession();
        if (this.settings.autosave === 'blur') for (const d of this.ws.dirtyDocs()) if (d.kind === 'project') this.ws.save(d.id, { quiet: true });
      } else if (Date.now() - hiddenAt > 800) {
        this.onResume();
      }
    });
    window.addEventListener('focus', () => { if (Date.now() - hiddenAt > 800 && hiddenAt) this.onResume(); });
    window.addEventListener('pagehide', () => { this.recovery.flushAll(); this.ws.saveSession(); });
    window.addEventListener('beforeunload', (e) => {
      this.recovery.flushAll();
      // (Reloading into an update keeps unsaved work: it is restored on start.)
      if (this.ws.dirtyDocs().length && !window.Capacitor && !this._updating) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /** Back from another app: files may have changed (git, Termux, a file manager). */
  onResume() {
    if (Date.now() - (this._updateCheckedAt || 0) > 60000) this.checkForUpdate();
    if (!this.project) return;
    this.ws.checkExternalChanges();
    this.fileCache = null;
    this.tree.refresh();
    if (this.activePanel === 'git') this.git.refresh();
  }

  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || window.Capacitor || !/^(https:|http:\/\/(localhost|127\.0\.0\.1))/.test(location.href) || window.__NO_SW__) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      this.swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) this.updateReady(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) this.updateReady(nw);
        });
      });
    }).catch(() => { /* offline support is optional */ });
    // The new version took over (after "Reload"): load its files.
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (this._updating) location.reload(); });
  }

  /** Esc outside the editor's own state: a maximized panel. */
  escapeApp() {
    const panel = $('#bottom-panel');
    if (panel.classList.contains('maximized')) { panel.classList.remove('maximized'); this.bottom.renderActions(); return 'Panel restored'; }
    return null;
  }

  /**
   * Cut / copy / paste for the keys bar (the keyboard's own shortcuts keep
   * working natively). With nothing selected, cut and copy take the whole
   * line, as in VS Code.
   */
  async clipboard(kind, v) {
    if (!v) return null;
    const { state } = v;
    if (kind === 'paste') {
      if (state.readOnly) return null;
      let text;
      try { text = await navigator.clipboard.readText(); } catch { toast('This browser blocked reading the clipboard: use the keyboard\'s paste instead.', 'warn'); return null; }
      v.dispatch(v.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
      return 'Pasted';
    }
    const ranges = state.selection.ranges.filter((r) => !r.empty);
    const whole = !ranges.length;
    const text = whole ? state.doc.lineAt(state.selection.main.head).text + state.lineBreak : ranges.map((r) => state.sliceDoc(r.from, r.to)).join(state.lineBreak);
    try { await navigator.clipboard.writeText(text); } catch { toast('This browser blocked the clipboard.', 'warn'); return null; }
    if (kind === 'cut' && !state.readOnly) {
      if (whole) E.deleteLine(v);
      else v.dispatch(v.state.replaceSelection(''), { userEvent: 'delete.cut', scrollIntoView: true });
    }
    return kind === 'cut' ? 'Cut' : 'Copied';
  }

  /**
   * A newer build is downloaded and waiting. Without this it would only start
   * once every tab of the app is closed (a reload isn't enough), which is
   * why a fresh merge seemed to take forever to show up.
   */
  async updateReady(worker) {
    this.updateWaiting = worker;
    const latest = await this.latestVersion();
    const name = latest && latest.version ? `Version ${latest.version}` : 'A new version';
    toast(`${name} is ready.`, 'info', 20000, { label: 'Reload', run: () => this.applyUpdate() });
  }

  applyUpdate() {
    const worker = this.updateWaiting || (this.swReg && this.swReg.waiting);
    this.recovery.flushAll();
    this.ws.saveSession();
    this._updating = true;
    if (worker) worker.postMessage('skip-waiting'); // → controllerchange → reload
    else location.reload();
  }

  /** What the website serves right now: version.json is never cached. */
  async latestVersion() {
    try {
      const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  /**
   * Compares this build with the server's. A different build makes the
   * service worker fetch it; updateReady() then offers the Reload button.
   * @returns {Promise<{error?:true, upToDate?:boolean, ready?:boolean, latest?:{version:string, built:string}}>}
   */
  async checkForUpdate() {
    this._updateCheckedAt = Date.now();
    const latest = await this.latestVersion();
    if (!latest) return { error: true };
    if (latest.built === BUILT || !BUILT) return { upToDate: true, latest };
    const reg = this.swReg;
    if (reg && reg.waiting) { this.updateReady(reg.waiting); return { upToDate: false, ready: true, latest }; }
    if (reg) reg.update().catch(() => {});
    return { upToDate: false, ready: false, hasWorker: !!reg, latest };
  }
}

// ---- key matching ---------------------------------------------------------------------------

const FIELD_SAFE = new Set(['save', 'saveAll', 'quickOpen', 'commandPalette', 'toggleSidebar', 'searchProject']);
/** Shortcuts that only mean something while typing in the editor. */
const EDITOR_ONLY = new Set(['newlineBelow', 'completeStatement', 'newlineAbove']);

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

function parseKey(spec) {
  const parts = spec.split(/-(?!$)/);
  let key = parts.pop();
  if (key === '') key = '-';
  const mods = new Set(parts);
  const label = [...parts.map((m) => (m === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : m)), key.replace('Arrow', '')].join('+');
  return { key, mod: mods.has('Mod'), ctrl: mods.has('Ctrl'), shift: mods.has('Shift'), alt: mods.has('Alt'), label };
}

const CODE_KEYS = { '-': 'Minus', '=': 'Equal', '+': 'Equal', '\\': 'Backslash', '0': 'Digit0' };

function keyMatches(e, s) {
  const ctrl = s.ctrl || (s.mod && !isMac);
  const meta = s.mod && isMac;
  if (e.ctrlKey !== ctrl || e.metaKey !== meta || e.altKey !== s.alt) return false;
  if (s.key === '+') return e.key === '+' || e.code === 'Equal';
  if (e.shiftKey !== s.shift) return false;
  if (CODE_KEYS[s.key]) return e.code === CODE_KEYS[s.key] || e.key === s.key;
  return e.key.toLowerCase() === s.key.toLowerCase();
}

export { parseKey, keyMatches };
