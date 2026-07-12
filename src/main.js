// main.js
//
// This file is intentionally plain DOM manipulation — no framework.
// WHY NOT REACT/VUE HERE: the UI shell (tree, tabs, panels) is simple
// enough that a framework would mostly add build complexity without
// buying much, and keeping the bundle framework-free keeps first-load
// fast on a phone. If the feature set grows a lot (e.g. a real command
// palette, multiple resizable panes), reconsider — that's a legitimate
// point where React's component model starts paying for itself.

import { EditorManager } from './editor.js';
import { detectProvider, BrowserFSProvider, InMemoryFSProvider, saveAs, ensureWritePermission } from './fileSystem.js';
import { runJavaScript } from './run.js';
import { updatePreview } from './preview.js';
import { loadSettings, saveSettings } from './settings.js';
import { KeysBar } from './keysBar.js';
import { BOILERPLATE_FILES } from './boilerplate.js';

const el = (id) => document.getElementById(id);

const state = {
  provider: detectProvider(),
  rootHandle: null,
  settings: loadSettings(),
};

applySettingsToDom(state.settings);

const editorManager = new EditorManager(el('editor-mount'), {
  onDirtyChange: (tabId, dirty) => renderTabBar(),
});

const keysBar = new KeysBar(el('keys-bar'), editorManager, { onSave: saveActiveTab });
keysBar.setMode(state.settings.keysBarMode);

// ---- File tree ------------------------------------------------------

async function openFolder() {
  try {
    const root = await state.provider.pickFolder();
    state.rootHandle = root;
    el('project-name').textContent = root.name;
    const tree = await state.provider.listTree(root);
    renderFileTree(tree);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
      logToConsole([{ type: 'error', args: [`Could not open folder: ${err.message}`] }]);
    }
  }
}

function renderFileTree(nodes) {
  const container = el('file-tree');
  container.innerHTML = '';
  container.appendChild(buildTreeDom(nodes));
}

function buildTreeDom(nodes) {
  const wrap = document.createElement('div');
  for (const node of nodes) {
    const row = document.createElement('div');
    row.className = `tree-node ${node.kind}`;
    row.textContent = (node.kind === 'directory' ? '\u{1F4C1} ' : '\u{1F4C4} ') + node.name;
    wrap.appendChild(row);

    if (node.kind === 'directory') {
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'tree-children hidden';
      childrenWrap.appendChild(buildTreeDom(node.children));
      wrap.appendChild(childrenWrap);
      row.addEventListener('click', () => childrenWrap.classList.toggle('hidden'));
    } else {
      row.addEventListener('click', async () => {
        const content = await state.provider.readFile(node.handle);
        editorManager.openTab({
          name: node.name,
          path: node.path,
          content,
          fileHandle: node.handle,
          providerKind: 'browser',
        });
        renderTabBar();
        document.querySelectorAll('.tree-node.file.active').forEach((n) => n.classList.remove('active'));
        row.classList.add('active');
      });
    }
  }
  return wrap;
}

// ---- Create file / folder / project -------------------------------------
//
// All three need a real directory handle to create into, which only
// BrowserFSProvider has (InMemoryFSProvider has no folder concept — you
// can't "create a file inside" a set of loose in-memory files). So these
// all guard on state.rootHandle existing first, with a message telling
// the user to open a real folder if it doesn't. This is the same
// "provider-aware, honest about limits" pattern as writeFile/readFile.
//
// window.prompt() is a deliberately low-tech choice for naming dialogs —
// it works, needs zero extra UI code, and is a fine placeholder. Once
// this is wrapped in Capacitor, @capacitor/dialog gives a native-styled
// prompt instead; swapping that in later is a small, isolated change,
// not a rewrite — same "thin seam" idea as fileSystem.js.

function requireRootHandle(actionLabel) {
  if (!(state.provider instanceof BrowserFSProvider) || !state.rootHandle) {
    logToConsole([{ type: 'error', args: [
      `${actionLabel} needs a real opened folder (File System Access API). Use "Open Folder" first.`,
    ] }]);
    return null;
  }
  return state.rootHandle;
}

async function refreshTree() {
  const tree = await state.provider.listTree(state.rootHandle);
  renderFileTree(tree);
}

async function createNewFile() {
  const root = requireRootHandle('New File');
  if (!root) return;
  // Checked BEFORE window.prompt() deliberately — see ensureWritePermission's
  // comment in fileSystem.js. Doing this after the prompt is what caused
  // the "user activation is required" error: the prompt can eat several
  // seconds of the click's short-lived activation window before this ever
  // runs.
  if (!(await ensureWritePermission(root))) {
    logToConsole([{ type: 'error', args: ['Write permission was denied for this folder.'] }]);
    return;
  }
  const name = window.prompt('New file name (e.g. utils.js):');
  if (!name) return;
  try {
    const fileHandle = await state.provider.createFile(root, name);
    await refreshTree();
    const content = await state.provider.readFile(fileHandle);
    editorManager.openTab({ name, path: name, content, fileHandle, providerKind: 'browser' });
    renderTabBar();
  } catch (err) {
    logToConsole([{ type: 'error', args: [`Could not create file: ${err.message}`] }]);
  }
}

async function createNewFolder() {
  const root = requireRootHandle('New Folder');
  if (!root) return;
  if (!(await ensureWritePermission(root))) {
    logToConsole([{ type: 'error', args: ['Write permission was denied for this folder.'] }]);
    return;
  }
  const name = window.prompt('New folder name:');
  if (!name) return;
  try {
    await state.provider.createFolder(root, name);
    await refreshTree();
  } catch (err) {
    logToConsole([{ type: 'error', args: [`Could not create folder: ${err.message}`] }]);
  }
}

async function createNewProject() {
  const root = requireRootHandle('New Project');
  if (!root) return;
  if (!(await ensureWritePermission(root))) {
    logToConsole([{ type: 'error', args: ['Write permission was denied for this folder.'] }]);
    return;
  }
  const name = window.prompt('Project folder name:', 'my-project');
  if (!name) return;
  try {
    const projectDir = await state.provider.createFolder(root, name);
    for (const file of BOILERPLATE_FILES) {
      await state.provider.writeNewFile(projectDir, file.name, file.content);
    }
    await refreshTree();
    logToConsole([{ type: 'log', args: [
      `Created ${name}/ with index.html, style.css, main.js, app.js. Expand it in the file tree to open them.`,
    ] }]);
  } catch (err) {
    logToConsole([{ type: 'error', args: [`Could not create project: ${err.message}`] }]);
  }
}


async function openFilesFallback(fileList) {
  if (!(state.provider instanceof InMemoryFSProvider)) {
    // still allow ad-hoc single-file opening even with real folder access,
    // e.g. a file outside the picked folder
    state.provider = new InMemoryFSProvider();
  }
  const opened = await state.provider.openFilesFromPicker(fileList);
  for (const f of opened) {
    f.handle.suggestedName = f.name;
    editorManager.openTab({
      name: f.name,
      path: f.path,
      content: f.handle.lastContents,
      fileHandle: f.handle,
      providerKind: 'memory',
    });
  }
  renderTabBar();
}

// ---- Tabs -------------------------------------------------------------

function renderTabBar() {
  const bar = el('tab-bar');
  bar.innerHTML = '';
  for (const tab of editorManager.tabs.values()) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.id === editorManager.activeId ? ' active' : '');

    const label = document.createElement('span');
    label.textContent = tab.name;
    tabEl.appendChild(label);

    if (tab.dirty) {
      const dot = document.createElement('span');
      dot.className = 'dirty-dot';
      tabEl.appendChild(dot);
    }

    const closeBtn = document.createElement('span');
    closeBtn.className = 'close-x';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editorManager.closeTab(tab.id);
      renderTabBar();
    });
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', () => {
      editorManager.switchTo(tab.id);
      renderTabBar();
    });

    bar.appendChild(tabEl);
  }
}

// ---- Save ---------------------------------------------------------------

async function saveActiveTab() {
  const tab = editorManager.getActiveTab();
  if (!tab) return;
  const content = editorManager.getContent(tab.id);
  try {
    if (!(await ensureWritePermission(tab.fileHandle))) {
      logToConsole([{ type: 'error', args: ['Write permission was denied for this file.'] }]);
      return;
    }
    await state.provider.writeFile(tab.fileHandle, content);
    editorManager.markSaved(tab.id);
    renderTabBar();
  } catch (err) {
    logToConsole([{ type: 'error', args: [`Save failed: ${err.message}`] }]);
  }
}

/** Save As — always goes through the native save-file picker / download,
 * regardless of which provider opened the file. Does NOT retarget the
 * tab's own fileHandle, so Ctrl+S afterwards still saves to the ORIGINAL
 * location — "Save As" here means "also export a copy," not "move this
 * file." Worth revisiting once you want true rename-on-save behavior. */
async function saveActiveTabAs() {
  const tab = editorManager.getActiveTab();
  if (!tab) return;
  const content = editorManager.getContent(tab.id);
  try {
    await saveAs(tab.name, content);
  } catch (err) {
    if (err.name !== 'AbortError') {
      logToConsole([{ type: 'error', args: [`Save As failed: ${err.message}`] }]);
    }
  }
}

async function saveAllTabs() {
  const dirtyTabs = [...editorManager.tabs.values()].filter((t) => t.dirty);
  if (dirtyTabs.length === 0) {
    logToConsole([{ type: 'log', args: ['Nothing to save — no unsaved changes.'] }]);
    return;
  }
  let failed = 0;
  for (const tab of dirtyTabs) {
    try {
      if (!(await ensureWritePermission(tab.fileHandle))) { failed++; continue; }
      await state.provider.writeFile(tab.fileHandle, editorManager.getContent(tab.id));
      editorManager.markSaved(tab.id);
    } catch (err) {
      failed++;
    }
  }
  renderTabBar();
  logToConsole([{ type: failed ? 'error' : 'log', args: [
    `Saved ${dirtyTabs.length - failed}/${dirtyTabs.length} file(s).` + (failed ? ' Some failed — check they still exist.' : ''),
  ] }]);
}

// ---- Run / Console ------------------------------------------------------

function logToConsole(entries) {
  const out = el('console-output');
  for (const entry of entries) {
    const line = document.createElement('div');
    line.className = `console-line ${entry.type}`;
    const prefix = document.createElement('span');
    prefix.className = 'prefix';
    prefix.textContent = { log: '>', warn: '\u26A0', error: '\u2716', result: '=' }[entry.type] || '>';
    line.appendChild(prefix);
    line.appendChild(document.createTextNode(entry.args.join(' ')));
    out.appendChild(line);
  }
  out.scrollTop = out.scrollHeight;
}

function runActiveFile() {
  const tab = editorManager.getActiveTab();
  if (!tab) return;
  showBottomTab('console');
  const runBtn = el('btn-run');

  if (/\.js$/i.test(tab.name)) {
    const code = editorManager.getContent(tab.id);
    el('console-output').innerHTML = '';
    logToConsole([{ type: 'log', args: [`Running ${tab.name}...`] }]);
    runBtn.classList.add('running');
    runJavaScript(code, (entries) => {
      runBtn.classList.remove('running');
      logToConsole(entries);
    });
  } else if (/\.html?$/i.test(tab.name)) {
    runPreview();
  } else {
    logToConsole([{ type: 'error', args: [`Don't know how to run "${tab.name}" yet — only .js execution and .html preview are wired up so far.`] }]);
  }
}

function runPreview() {
  const tab = editorManager.getActiveTab();
  const htmlTab = tab && /\.html?$/i.test(tab.name) ? tab
    : [...editorManager.tabs.values()].find((t) => /\.html?$/i.test(t.name));
  if (!htmlTab) {
    logToConsole([{ type: 'error', args: ['Open an .html file to preview it.'] }]);
    return;
  }
  // Baseline limitation: we only pull CSS/JS from files that are already
  // open as tabs (matched by same folder as the html file), not from
  // <link>/<script src> attributes resolved against disk. Good next
  // feature to build together.
  const folder = htmlTab.path.includes('/') ? htmlTab.path.slice(0, htmlTab.path.lastIndexOf('/')) : '';
  const siblings = [...editorManager.tabs.values()].filter((t) => {
    const tFolder = t.path.includes('/') ? t.path.slice(0, t.path.lastIndexOf('/')) : '';
    return tFolder === folder;
  });
  const cssContent = siblings.filter((t) => /\.css$/i.test(t.name)).map((t) => editorManager.getContent(t.id)).join('\n');
  const jsContent = siblings.filter((t) => /\.js$/i.test(t.name)).map((t) => editorManager.getContent(t.id)).join('\n');

  updatePreview(el('preview-frame'), {
    htmlBody: editorManager.getContent(htmlTab.id),
    css: cssContent,
    js: jsContent,
  });
  showBottomTab('preview');
}

// ---- Bottom panel resize handle ------------------------------------------
//
// Pointer Events (not separate mouse/touch listeners) because they unify
// mouse, touch, and pen input behind one API — one drag implementation
// instead of three. setPointerCapture keeps receiving move/up events for
// this pointer even if it moves outside the handle element, which a plain
// mousemove-on-the-handle listener would lose.

function setupPanelResize() {
  const handle = el('panel-resize-handle');
  const panel = el('bottom-panel');
  let startY = 0;
  let startHeight = 0;

  handle.addEventListener('pointerdown', (e) => {
    if (panel.classList.contains('collapsed')) return;
    startY = e.clientY;
    startHeight = panel.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp, { once: true });
  });

  function onMove(e) {
    const delta = startY - e.clientY; // dragging up = taller panel
    const newHeight = Math.min(Math.max(startHeight + delta, 120), window.innerHeight * 0.75);
    panel.style.height = newHeight + 'px';
  }

  function onUp() {
    handle.removeEventListener('pointermove', onMove);
    state.settings.panelHeight = Math.round(panel.getBoundingClientRect().height);
    saveSettings(state.settings);
  }
}

function showBottomTab(which) {
  el('bottom-panel').classList.remove('collapsed');
  el('tab-console').classList.toggle('active', which === 'console');
  el('tab-preview').classList.toggle('active', which === 'preview');
  el('console-output').classList.toggle('hidden', which !== 'console');
  el('preview-frame').classList.toggle('hidden', which !== 'preview');
}

// ---- Settings -----------------------------------------------------------

function applySettingsToDom(settings) {
  document.body.classList.toggle('theme-light', settings.theme === 'light');
}

function openSettingsDrawer() {
  el('setting-theme').value = state.settings.theme;
  el('setting-fontsize').value = state.settings.fontSize;
  el('setting-tabwidth').value = state.settings.tabWidth;
  el('setting-keysbar').value = state.settings.keysBarMode;
  el('settings-drawer').classList.remove('hidden');
}

// ---- Dropdown menus (New / Save) -----------------------------------------
//
// One tiny generic helper instead of two near-identical menu implementations.
// Closes on outside click OR after any item inside is chosen, since leaving
// a menu open after the user acted on it is the most common "dropdown feels
// broken" complaint.

function wireDropdown(buttonId, menuId) {
  const button = el(buttonId);
  const menu = el(menuId);
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = menu.classList.contains('hidden');
    document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.add('hidden'));
    if (willOpen) menu.classList.remove('hidden');
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('.dropdown-item')) menu.classList.add('hidden');
  });
}
document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.add('hidden'));
});

wireDropdown('btn-new-menu', 'new-menu');
wireDropdown('btn-save-menu', 'save-menu');

// ---- Wire up events -------------------------------------------------------

el('btn-open-folder').addEventListener('click', openFolder);
el('btn-open-folder-empty').addEventListener('click', openFolder);
el('btn-open-file').addEventListener('click', () => el('hidden-file-input').click());
el('hidden-file-input').addEventListener('change', (e) => openFilesFallback(e.target.files));
el('btn-save').addEventListener('click', saveActiveTab);
el('btn-save-as').addEventListener('click', saveActiveTabAs);
el('btn-save-all').addEventListener('click', saveAllTabs);
el('btn-new-file').addEventListener('click', createNewFile);
el('btn-new-folder').addEventListener('click', createNewFolder);
el('btn-new-project').addEventListener('click', createNewProject);
el('btn-run').addEventListener('click', runActiveFile);
el('btn-settings').addEventListener('click', openSettingsDrawer);
el('btn-close-settings').addEventListener('click', () => el('settings-drawer').classList.add('hidden'));

el('tab-console').addEventListener('click', () => showBottomTab('console'));
el('tab-preview').addEventListener('click', () => runPreview());
el('btn-collapse-panel').addEventListener('click', () => {
  const panel = el('bottom-panel');
  const collapsing = !panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed');
  // Dragging the resize handle sets panel.style.height directly (an inline
  // style), which always wins over the .collapsed CSS rule's height — so
  // collapsing has to clear that inline style itself rather than relying
  // on the class alone, or a previously-resized panel would stop collapsing.
  panel.style.height = collapsing ? '' : state.settings.panelHeight + 'px';
});

setupPanelResize();

el('setting-theme').addEventListener('change', (e) => {
  state.settings.theme = e.target.value;
  applySettingsToDom(state.settings);
  editorManager.setTheme(e.target.value === 'dark');
  saveSettings(state.settings);
});
el('setting-fontsize').addEventListener('change', (e) => {
  state.settings.fontSize = Number(e.target.value);
  editorManager.setFontSize(state.settings.fontSize);
  saveSettings(state.settings);
});
el('setting-tabwidth').addEventListener('change', (e) => {
  state.settings.tabWidth = Number(e.target.value);
  editorManager.setTabWidth(state.settings.tabWidth);
  saveSettings(state.settings);
});
el('setting-keysbar').addEventListener('change', (e) => {
  state.settings.keysBarMode = e.target.value;
  keysBar.setMode(e.target.value);
  saveSettings(state.settings);
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (e.shiftKey) saveAllTabs();
    else saveActiveTab();
  }
});

// initial apply
editorManager.setFontSize(state.settings.fontSize);
editorManager.setTabWidth(state.settings.tabWidth);
editorManager.setTheme(state.settings.theme === 'dark');
el('bottom-panel').style.height = state.settings.panelHeight + 'px';

if (!(state.provider instanceof BrowserFSProvider)) {
  logToConsole([{ type: 'log', args: ['Real folder access (File System Access API) is not supported here — using file-import/download mode instead. This is expected in Capacitor/WebView wrappers until CapacitorFSProvider is wired in.'] }]);
}
