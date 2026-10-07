// app/workspace.js — open documents, editor panes, tabs, saving, recovery.
//
// Model:
//   Document  one per open file: path, on-disk format (encoding, BOM, line
//             endings), last-saved text, dirty flag, per-file toggles.
//   Pane      one editor view + its tabs. There are one or two panes (split
//             editor, spec §3.5). Each pane keeps its own EditorState per
//             document — cursor, scroll and undo history are per pane, like
//             VS Code.
//
// When the same file is open in both panes, every edit in one is replayed in
// the other (see _propagate). That keeps the two EditorStates identical without
// sharing one object — a CodeMirror state can only live in one view.

import { EditorView } from '@codemirror/view';
import { EditorState, Transaction, Annotation, Text } from '@codemirror/state';
import { comp, buildExtensions, wrapExtension, readOnlyExtension, indentExtension, lineNumbersExtension,
  closeBracketsExtension, lintExtension, stickyExtension, fastScrollExtension, langDataExtension } from '../editor/setup.js';
import { languageForName, loadLanguage, languageById } from '../editor/languages.js';
import { setGitBase } from '../editor/gitGutter.js';
import { decodeBytes, encodeText, applySaveTransforms, hashString, degradeFor, EOL } from '../core/textFormat.js';
import { resolveEditorConfig } from '../core/editorconfig.js';
import { detectIndent } from '../core/indent.js';
import { NavHistory } from '../core/navHistory.js';
import { dirname, basename } from '../core/paths.js';
import { parseUserSnippets } from '../editor/snippets.js';
import { kv } from '../storage/db.js';

const syncAnno = Annotation.define();
export const externalAnno = Annotation.define(); // reloads, formatting

let nextDocId = 1;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const sameText = (a, b) => a.length === b.length && a.eq(b);

/** Smallest single replacement turning `oldText` into `newText` (keeps cursor/undo sane). */
export function minimalChange(oldText, newText) {
  if (oldText === newText) return null;
  let start = 0;
  const max = Math.min(oldText.length, newText.length);
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  let endOld = oldText.length, endNew = newText.length;
  while (endOld > start && endNew > start && oldText.charCodeAt(endOld - 1) === newText.charCodeAt(endNew - 1)) { endOld--; endNew--; }
  return { from: start, to: endOld, insert: newText.slice(start, endNew) };
}

class Pane {
  constructor(ws, index, host) {
    this.ws = ws;
    this.index = index;
    this.host = host;
    this.tabs = [];
    this.activeId = null;
    this.states = new Map();
    this.scroll = new Map();
    this.view = new EditorView({
      state: EditorState.create({ doc: '' }),
      parent: host,
      dispatchTransactions: (trs, view) => ws._onTransactions(this, trs, view),
    });
    this.view.dom.classList.add('is-empty');
  }

  stateOf(docId) {
    return docId === this.activeId ? this.view.state : this.states.get(docId);
  }

  destroy() {
    this.view.destroy();
  }
}

export class Workspace {
  /**
   * @param {object} o
   * @param {() => object} o.getSettings
   * @param {import('../storage/recovery.js').RecoveryStore} o.recovery
   * @param {import('../storage/localHistory.js').LocalHistory} o.history
   * @param {object} o.ui  {choose, prompt, toast}
   * @param {any[]} o.extensions extra editor extensions (keymaps, gesture layer)
   */
  constructor({ getSettings, recovery, history, ui, extensions = [] }) {
    this.getSettings = getSettings;
    this.recovery = recovery;
    this.history = history;
    this.ui = ui;
    this.extraExtensions = extensions;
    this.project = null; // {meta, fs}
    this.docs = new Map();
    this.panes = [null, null];
    this.activePane = 0;
    this.nav = new NavHistory();
    this.listeners = new Map();
    this.editorConfigCache = new Map();
    this.gitBaseProvider = null; // async (path) => string|null
    this.autosaveTimers = new Map();
    this.saveQueue = new Map();
    this.userSnippets = parseUserSnippets(getSettings().userSnippets).snippets;
  }

  // ---- events -------------------------------------------------------------

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) {
      try { fn(payload); } catch (err) { console.error(`listener for ${event} failed`, err); }
    }
  }

  // ---- panes ----------------------------------------------------------------

  attachPane(index, host) {
    this.panes[index] = new Pane(this, index, host);
    return this.panes[index];
  }

  get pane() { return this.panes[this.activePane]; }
  get view() { return this.pane.view; }

  get activeDoc() {
    const p = this.pane;
    return p && p.activeId != null ? this.docs.get(p.activeId) : null;
  }

  setActivePane(index) {
    if (!this.panes[index] || this.activePane === index) return;
    this.activePane = index;
    this.emit('active', { pane: this.pane, doc: this.activeDoc });
  }

  isSplit() { return !!this.panes[1] && this.panes[1].visible !== false; }

  /** The pane that last showed a document (for "reveal") or the active one. */
  paneFor(docId) {
    if (this.pane && this.pane.tabs.includes(docId)) return this.pane;
    return this.panes.find((p) => p && p.tabs.includes(docId)) || null;
  }

  stateOf(docId) {
    for (const p of this.panes) if (p && p.activeId === docId) return p.view.state;
    for (const p of this.panes) if (p && p.states.has(docId)) return p.states.get(docId);
    return null;
  }

  textOf(docId) {
    const s = this.stateOf(docId);
    return s ? s.doc.toString() : '';
  }

  /** Applies a transaction spec to a document, wherever it is open. */
  dispatchToDoc(docId, spec) {
    const visible = this.panes.find((p) => p && p.activeId === docId);
    if (visible) { visible.view.dispatch(spec); return; }
    const p = this.panes.find((q) => q && q.states.has(docId));
    if (!p) return;
    const tr = p.states.get(docId).update(spec);
    p.states.set(docId, tr.state);
    if (tr.docChanged) {
      this._propagate(p, docId, tr);
      this._afterDocChange(this.docs.get(docId), tr.state);
    }
  }

  /** Reconfigures every EditorState of a document (or all documents). */
  reconfigure(effectsFor, docId = null) {
    for (const p of this.panes) {
      if (!p) continue;
      for (const id of p.tabs) {
        if (docId != null && id !== docId) continue;
        const effects = effectsFor(this.docs.get(id));
        if (!effects) continue;
        if (p.activeId === id) p.view.dispatch({ effects });
        else p.states.set(id, p.states.get(id).update({ effects }).state);
      }
    }
  }

  _onTransactions(pane, trs, view) {
    view.update(trs);
    const docId = pane.activeId;
    if (docId == null) return;
    const doc = this.docs.get(docId);
    if (!doc) return;
    let changed = false, selection = false, userEdit = false;
    for (const tr of trs) {
      if (tr.docChanged) {
        changed = true;
        if (!tr.annotation(syncAnno)) this._propagate(pane, docId, tr);
        if (tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('undo') || tr.isUserEvent('redo')) userEdit = true;
      }
      if (tr.selection) selection = true;
    }
    if (changed) this._afterDocChange(doc, view.state, userEdit);
    if ((changed || selection) && pane === this.pane) this.emit('selection', { doc, state: view.state, pane });
  }

  _propagate(fromPane, docId, tr) {
    for (const p of this.panes) {
      if (!p || p === fromPane || !p.tabs.includes(docId)) continue;
      const spec = { changes: tr.changes, annotations: [syncAnno.of(true), Transaction.addToHistory.of(false)] };
      if (p.activeId === docId) p.view.dispatch(spec);
      else p.states.set(docId, p.states.get(docId).update(spec).state);
    }
  }

  _afterDocChange(doc, state, userEdit = false) {
    const dirty = !sameText(state.doc, doc.saved);
    if (dirty !== doc.dirty) {
      doc.dirty = dirty;
      this.emit('docs', { doc });
    }
    if (dirty) this.recovery.schedule(doc.key, () => this._recoveryEntry(doc));
    else this.recovery.remove(doc.key);
    this.emit('change', { doc, state, userEdit });
    const s = this.getSettings();
    if (dirty && s.autosave === 'delay' && doc.kind === 'project') {
      clearTimeout(this.autosaveTimers.get(doc.id));
      this.autosaveTimers.set(doc.id, setTimeout(() => {
        if (this.docs.has(doc.id) && doc.dirty) this.save(doc.id, { quiet: true });
      }, s.autosaveDelay));
    }
  }

  _recoveryEntry(doc) {
    if (!this.docs.has(doc.id) || !doc.dirty) return null;
    const state = this.stateOf(doc.id);
    if (!state) return null;
    return {
      projectId: doc.kind === 'project' ? this.project?.meta.id ?? null : null,
      kind: doc.kind,
      path: doc.path,
      name: doc.name,
      fileHandle: doc.fileHandle || null,
      content: state.doc.toString(),
      format: doc.format,
      disk: doc.disk,
      langId: doc.lang.id,
      anchor: state.selection.main.anchor,
      head: state.selection.main.head,
    };
  }

  // ---- project --------------------------------------------------------------

  async setProject(project) {
    await this.closeAll({ force: false, keepUntitled: true });
    this.project = project;
    this.editorConfigCache.clear();
    this.nav = new NavHistory();
    this.emit('project', { project });
    if (project) await this.restoreSession();
  }

  sessionKey() {
    return this.project ? `session:${this.project.meta.id}` : 'session:none';
  }

  saveSessionSoon() {
    clearTimeout(this._sessionTimer);
    this._sessionTimer = setTimeout(() => this.saveSession(), 400);
  }

  async saveSession() {
    if (!this.project) return;
    const panes = this.panes.map((p) => (p && p.visible !== false ? {
      tabs: p.tabs.map((id) => this.docs.get(id)).filter((d) => d && d.kind === 'project').map((d) => d.path),
      active: p.activeId != null ? this.docs.get(p.activeId)?.path ?? null : null,
    } : null));
    try {
      await kv.set(this.sessionKey(), { panes, activePane: this.activePane, savedAt: Date.now() });
    } catch { /* ignore */ }
  }

  async restoreSession() {
    let session = null;
    try { session = await kv.get(this.sessionKey()); } catch { /* ignore */ }
    if (session && session.panes) {
      for (let i = 0; i < session.panes.length; i++) {
        const sp = session.panes[i];
        if (!sp || !sp.tabs.length) continue;
        if (i === 1) this.emit('want-split', {});
        if (!this.panes[i]) continue;
        for (const path of sp.tabs) {
          await this.openPath(path, { paneIndex: i, activate: false, quiet: true, recordNav: false });
        }
        const active = sp.active && [...this.docs.values()].find((d) => d.path === sp.active);
        if (active) this.showDoc(i, active.id, { focus: false });
        else if (this.panes[i].tabs.length) this.showDoc(i, this.panes[i].tabs[0], { focus: false });
      }
      if (session.activePane && this.panes[session.activePane]) this.setActivePane(session.activePane);
    }
    await this.restoreRecovery();
  }

  /** Brings back unsaved buffers after the app was killed (spec §3.4). */
  async restoreRecovery() {
    const entries = await this.recovery.all();
    const projectId = this.project ? this.project.meta.id : null;
    let restored = 0;
    for (const e of entries) {
      if (e.kind === 'project' && e.projectId !== projectId) continue;
      if (e.kind === 'project' && !this.project) continue;
      try {
        let doc = [...this.docs.values()].find((d) => d.key === e.key);
        const created = !doc;
        if (!doc) {
          if (e.kind === 'project') {
            const exists = await this.project.fs.exists(e.path);
            if (exists) doc = await this.openPath(e.path, { activate: false, quiet: true, recordNav: false });
          }
          if (!doc) {
            doc = this._createDoc({
              key: e.key, kind: e.kind === 'project' ? 'untitled' : e.kind, name: e.name, path: e.kind === 'project' ? null : e.path,
              fileHandle: e.fileHandle, text: e.content, savedText: '', format: e.format, disk: null, langId: e.langId,
            });
            if (e.kind === 'project') doc.restoredFrom = e.path;
            this._addToPane(this.pane, doc, { selection: { anchor: e.anchor, head: e.head }, text: e.content });
          }
        }
        const current = this.textOf(doc.id);
        const changed = current !== e.content;
        if (changed) {
          const ch = minimalChange(current, e.content);
          if (ch) this.dispatchToDoc(doc.id, { changes: ch, annotations: externalAnno.of('recovery') });
        }
        if (!changed && !created) continue; // already restored earlier
        // If the file on disk changed after the buffer was mirrored, say so —
        // never silently pick one version (spec §3.4).
        if (doc.kind === 'project' && e.disk && doc.disk && e.disk.hash !== doc.disk.hash) {
          doc.conflict = { reason: 'recovered', diskText: doc.saved.toString() };
          this.emit('conflict', { doc });
        }
        restored++;
      } catch (err) {
        console.warn('could not restore buffer', e.path, err);
      }
    }
    if (restored) this.ui.toast(`Restored ${restored} unsaved file${restored > 1 ? 's' : ''} from the last session.`, 'info');
    this.emit('docs', {});
  }

  // ---- opening documents ----------------------------------------------------

  _createDoc({ key, kind, name, path = null, fileHandle = null, text, savedText = text, format, disk = null, langId = null, readOnlyReason = null }) {
    const settings = this.getSettings();
    const lang = langId ? languageById(langId) : languageForName(name);
    const degrade = degradeFor(text);
    const wrapAuto = settings.wrapDefault === 'on' || (settings.wrapDefault === 'auto' && window.innerWidth < 1000);
    const doc = {
      id: nextDocId++,
      key: key || `${kind}::${uid()}`,
      kind, name, path, fileHandle,
      lang,
      format: format || { encoding: 'utf-8', bom: false, eol: EOL.LF, mixedEol: false },
      disk,
      saved: Text.of(savedText.split('\n')),
      dirty: savedText !== text,
      locked: false,
      readOnlyReason: readOnlyReason || (degrade.readOnly ? `This file is very large (${degrade.reason}); opened read-only.` : null),
      degrade,
      wrap: degrade.wrap && wrapAuto,
      indent: { insertSpaces: settings.insertSpaces, indentSize: settings.tabWidth, tabWidth: settings.tabWidth },
      indentSource: 'settings',
      saveRules: {},
      conflict: null,
    };
    const detected = detectIndent(text);
    if (detected) {
      doc.indent = {
        insertSpaces: detected.insertSpaces,
        indentSize: detected.size || settings.tabWidth,
        tabWidth: detected.insertSpaces ? (detected.size || settings.tabWidth) : settings.tabWidth,
      };
      doc.indentSource = 'detected';
    }
    this.docs.set(doc.id, doc);
    return doc;
  }

  _buildState(doc, text, selection) {
    const settings = this.getSettings();
    const state = EditorState.create({
      doc: text,
      selection: selection && selection.anchor <= text.length && selection.head <= text.length ? selection : undefined,
      extensions: buildExtensions({ doc, settings, userSnippets: this.userSnippets, extra: this.extraExtensions }),
    });
    return state;
  }

  _addToPane(pane, doc, { selection, activate = true, text = null } = {}) {
    if (!pane.tabs.includes(doc.id)) {
      const content = text ?? (this.stateOf(doc.id)?.doc.toString() ?? doc.saved.toString());
      pane.states.set(doc.id, this._buildState(doc, content, selection));
      // Insert next to the active tab, like most editors.
      const at = pane.activeId != null ? pane.tabs.indexOf(pane.activeId) + 1 : pane.tabs.length;
      pane.tabs.splice(at, 0, doc.id);
      this._loadLanguageFor(doc);
      this._loadGitBase(doc);
    }
    if (activate) this.showDoc(pane.index, doc.id, { focus: false });
    this.emit('docs', { doc });
    this.saveSessionSoon();
  }

  async _loadLanguageFor(doc) {
    if (!doc.degrade.highlight) return;
    const ext = await loadLanguage(doc.lang.id);
    if (!this.docs.has(doc.id)) return;
    this.reconfigure(() => [
      comp.language.reconfigure(ext),
      comp.lint.reconfigure(lintExtension(!!doc.lang.lezer)),
    ], doc.id);
  }

  async _loadGitBase(doc) {
    if (!this.gitBaseProvider || doc.kind !== 'project') return;
    try {
      const base = await this.gitBaseProvider(doc.path);
      if (this.docs.has(doc.id)) this.reconfigure(() => setGitBase.of(base), doc.id);
    } catch { /* not a repo */ }
  }

  refreshGitBases() {
    for (const doc of this.docs.values()) this._loadGitBase(doc);
  }

  /** Shows a document in a pane (it must already be one of its tabs). */
  showDoc(paneIndex, docId, { focus = true } = {}) {
    const pane = this.panes[paneIndex];
    if (!pane || !pane.tabs.includes(docId)) return;
    if (pane.activeId !== docId) {
      if (pane.activeId != null && pane.tabs.includes(pane.activeId)) {
        pane.states.set(pane.activeId, pane.view.state);
        pane.scroll.set(pane.activeId, pane.view.scrollSnapshot());
      }
      pane.activeId = docId;
      pane.view.setState(pane.states.get(docId));
      pane.states.delete(docId); // the view owns it while visible
      const snap = pane.scroll.get(docId);
      if (snap) pane.view.dispatch({ effects: snap });
      pane.view.dom.classList.remove('is-empty');
    }
    this.activePane = paneIndex;
    if (focus) pane.view.focus();
    this.emit('active', { pane, doc: this.docs.get(docId) });
    this.emit('docs', {});
    this.saveSessionSoon();
  }

  async _readDoc(path) {
    const fs = this.project.fs;
    const { bytes, lastModified, size } = await fs.readBytes(path);
    const info = decodeBytes(bytes);
    return { info, disk: { lastModified, size, hash: hashString(info.text.replace(/\r\n?/g, '\n')) } };
  }

  async _editorConfigFor(path) {
    const fs = this.project.fs;
    const dirs = [''];
    const parts = dirname(path).split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) dirs.push(parts.slice(0, i).join('/'));
    const configs = [];
    for (const dir of dirs) {
      if (!this.editorConfigCache.has(dir)) {
        const p = dir ? `${dir}/.editorconfig` : '.editorconfig';
        let text = null;
        try { if (await fs.exists(p)) text = await fs.readText(p); } catch { /* ignore */ }
        this.editorConfigCache.set(dir, text);
      }
      const text = this.editorConfigCache.get(dir);
      if (text != null) configs.push({ dir, text });
    }
    return configs.length ? resolveEditorConfig(path, configs) : null;
  }

  _applyEditorConfig(doc, ec) {
    if (!ec) return;
    if (ec.indentStyle) {
      doc.indent = {
        insertSpaces: ec.indentStyle === 'space',
        indentSize: ec.indentSize || doc.indent.indentSize,
        tabWidth: ec.tabWidth || ec.indentSize || doc.indent.tabWidth,
      };
      doc.indentSource = '.editorconfig';
    } else if (ec.indentSize) {
      doc.indent = { ...doc.indent, indentSize: ec.indentSize, tabWidth: ec.tabWidth || ec.indentSize };
      doc.indentSource = '.editorconfig';
    }
    doc.saveRules = {
      trimTrailingWhitespace: ec.trimTrailingWhitespace,
      insertFinalNewline: ec.insertFinalNewline,
    };
    // end_of_line only decides NEW files' line endings; existing files keep
    // what they have (preserve, spec §6).
    if (ec.endOfLine && doc.saved.length === 0) doc.format.eol = { lf: EOL.LF, crlf: EOL.CRLF, cr: EOL.CR }[ec.endOfLine];
  }

  /**
   * Opens a project file (or focuses it if already open).
   * @returns {Promise<object|null>} the document
   */
  async openPath(path, { paneIndex = this.activePane, line = null, col = 1, activate = true, quiet = false, recordNav = true, focus = true } = {}) {
    if (!this.project) return null;
    const pane = this.panes[paneIndex] || this.pane;
    let doc = [...this.docs.values()].find((d) => d.kind === 'project' && d.path === path);
    if (recordNav && this.activeDoc && this.activeDoc.path) {
      this.nav.push({ path: this.activeDoc.path, line: this.view.state.doc.lineAt(this.view.state.selection.main.head).number });
    }
    if (!doc) {
      let read;
      try {
        read = await this._readDoc(path);
      } catch (err) {
        if (!quiet) this.ui.toast(`Could not open ${path}: ${err.message}`, 'error');
        return null;
      }
      const { info, disk } = read;
      if (info.binary) {
        if (!quiet) this.ui.toast(`${basename(path)} looks like a binary file, so it can't be edited here.`, 'warn');
        this.emit('binary', { path });
        return null;
      }
      const text = info.text.replace(/\r\n?/g, '\n');
      doc = this._createDoc({
        key: `${this.project.meta.id}::${path}`, kind: 'project', name: basename(path), path,
        text, format: { encoding: info.encoding, bom: info.bom, eol: info.eol, mixedEol: info.mixedEol },
        disk, readOnlyReason: info.readOnlyReason,
      });
      try { this._applyEditorConfig(doc, await this._editorConfigFor(path)); } catch { /* ignore */ }
      if (info.mixedEol && !quiet) this.ui.toast(`${doc.name} mixes line endings; saving will use ${info.eol === EOL.CRLF ? 'CRLF' : 'LF'} throughout.`, 'warn');
      if (doc.degrade.reason && !quiet) this.ui.toast(`Highlighting is off for ${doc.name} because ${doc.degrade.reason}.`, 'info');
    }
    this._addToPane(pane, doc, { activate });
    if (activate) {
      this.showDoc(pane.index, doc.id, { focus });
      if (line != null) this.revealLine(doc.id, line, col);
    }
    if (recordNav && line != null) this.nav.push({ path, line });
    return doc;
  }

  newUntitled({ name = null, content = '', langId = null } = {}) {
    const n = [...this.docs.values()].filter((d) => d.kind === 'untitled').length + 1;
    const doc = this._createDoc({ kind: 'untitled', name: name || `untitled-${n}.txt`, text: content, savedText: '', langId });
    doc.dirty = content.length > 0;
    this._addToPane(this.pane, doc, { text: content });
    this.showDoc(this.activePane, doc.id);
    return doc;
  }

  /** Files opened with a file picker, outside any project. */
  openLooseFile({ name, bytes, fileHandle = null, lastModified = 0 }) {
    const existing = fileHandle && [...this.docs.values()].find((d) => d.fileHandle === fileHandle);
    if (existing) { this.showDoc(this.activePane, existing.id); return existing; }
    const info = decodeBytes(bytes);
    if (info.binary) { this.ui.toast(`${name} looks like a binary file.`, 'warn'); return null; }
    const text = info.text.replace(/\r\n?/g, '\n');
    const doc = this._createDoc({
      kind: fileHandle ? 'handle' : 'download', name, fileHandle, text,
      format: { encoding: info.encoding, bom: info.bom, eol: info.eol, mixedEol: info.mixedEol },
      disk: { lastModified, size: bytes.length, hash: hashString(text) }, readOnlyReason: info.readOnlyReason,
    });
    this._addToPane(this.pane, doc);
    this.showDoc(this.activePane, doc.id);
    return doc;
  }

  revealLine(docId, line, col = 1) {
    const state = this.stateOf(docId);
    if (!state) return;
    const ln = state.doc.line(Math.max(1, Math.min(line, state.doc.lines)));
    const pos = Math.min(ln.to, ln.from + Math.max(0, col - 1));
    this.revealPos(docId, pos);
  }

  revealPos(docId, from, to = from) {
    const pane = this.paneFor(docId);
    if (!pane) return;
    if (pane.activeId !== docId) this.showDoc(pane.index, docId, { focus: false });
    pane.view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    pane.view.focus();
  }

  async navigate(direction) {
    const cur = this.activeDoc;
    if (cur && cur.path) this.nav.updateCurrent({ path: cur.path, line: this.view.state.doc.lineAt(this.view.state.selection.main.head).number });
    const loc = direction < 0 ? this.nav.back() : this.nav.forward();
    if (!loc) return false;
    await this.openPath(loc.path, { line: loc.line, recordNav: false });
    return true;
  }

  // ---- saving -------------------------------------------------------------------

  /** Saves are queued per document, so two quick saves never interleave their writes. */
  save(docId = this.activeDoc?.id, opts = {}) {
    const prev = this.saveQueue.get(docId) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => this._save(docId, opts));
    this.saveQueue.set(docId, next);
    next.finally(() => { if (this.saveQueue.get(docId) === next) this.saveQueue.delete(docId); });
    return next;
  }

  async _save(docId, { quiet = false, saveAs = false } = {}) {
    const doc = this.docs.get(docId);
    if (!doc) return false;
    if (doc.readOnlyReason) { this.ui.toast(doc.readOnlyReason, 'warn'); return false; }
    this.emit('before-save', { doc });
    if (this.beforeSaveHook) await this.beforeSaveHook(doc);

    let text = this.textOf(doc.id);
    const transformed = applySaveTransforms(text, doc.saveRules);
    if (transformed !== text) {
      const ch = minimalChange(text, transformed);
      this.dispatchToDoc(doc.id, { changes: ch, annotations: externalAnno.of('save-transform') });
      text = transformed;
    }
    // Remember exactly which version is being written: the user may keep
    // typing while the write is in flight, and those edits are NOT saved.
    const writtenDoc = this.stateOf(doc.id).doc;
    const bytes = encodeText(text, doc.format);

    try {
      if (doc.kind === 'project' && !saveAs) {
        const fs = this.project.fs;
        // Never silently overwrite a file somebody else changed (spec §3.4).
        const st = await fs.stat(doc.path);
        if (st && doc.disk && (st.lastModified !== doc.disk.lastModified || st.size !== doc.disk.size)) {
          const { info } = await this._readDoc(doc.path);
          if (hashString(info.text) !== doc.disk.hash) {
            const choice = await this.ui.choose({
              title: 'File changed on disk',
              message: `${doc.path} was changed by another app since you opened it.`,
              buttons: [
                { id: 'overwrite', label: 'Overwrite with mine', kind: 'danger' },
                { id: 'compare', label: 'Compare' },
                { id: 'cancel', label: 'Cancel' },
              ],
            });
            if (choice === 'compare') { this.emit('compare', { doc, diskText: info.text.replace(/\r\n?/g, '\n') }); return false; }
            if (choice !== 'overwrite') return false;
          }
        }
        const res = await fs.writeBytes(doc.path, bytes);
        doc.disk = { lastModified: res.lastModified, size: res.size, hash: hashString(text) };
        doc.deletedOnDisk = false;
        if (basename(doc.path) === '.editorconfig') this.editorConfigCache.clear();
      } else if (doc.kind === 'handle' && !saveAs) {
        if (doc.fileHandle.queryPermission && (await doc.fileHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          if ((await doc.fileHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('write permission was denied');
        }
        const w = await doc.fileHandle.createWritable();
        await w.write(bytes);
        await w.close();
      } else {
        const ok = await this._saveAs(doc, bytes, text);
        if (!ok) return false;
      }
    } catch (err) {
      if (err.name === 'AbortError') return false;
      this.ui.toast(`Save failed: ${err.message}`, 'error');
      return false;
    }

    doc.saved = writtenDoc;
    doc.dirty = !sameText(this.stateOf(doc.id).doc, writtenDoc);
    doc.conflict = null;
    clearTimeout(this.autosaveTimers.get(doc.id));
    if (!doc.dirty) await this.recovery.remove(doc.key);
    if (doc.kind === 'project') await this.history.snapshot(doc.key, doc.path, text);
    this.emit('docs', { doc });
    this.emit('saved', { doc });
    if (!quiet) this.ui.toast(`Saved ${doc.name}`, 'success', 1200);
    return true;
  }

  async _saveAs(doc, bytes, text) {
    // Inside a project: save into the project (becomes a normal project file).
    if (this.project) {
      const suggested = doc.restoredFrom || (doc.path ? doc.path : doc.name);
      const path = await this.ui.prompt({ title: 'Save as', label: 'Path inside the project', value: suggested });
      if (!path) return false;
      const fs = this.project.fs;
      if (await fs.exists(path)) {
        const c = await this.ui.choose({ title: 'Replace file?', message: `${path} already exists.`, buttons: [{ id: 'yes', label: 'Replace', kind: 'danger' }, { id: 'no', label: 'Cancel' }] });
        if (c !== 'yes') return false;
      }
      const dir = dirname(path);
      if (dir) await fs.createDir(dir, { recursive: true });
      const res = await fs.writeBytes(path, bytes);
      const oldKey = doc.key;
      await this.recovery.remove(oldKey);
      Object.assign(doc, { kind: 'project', path, name: basename(path), key: `${this.project.meta.id}::${path}`, fileHandle: null, restoredFrom: null });
      doc.disk = { lastModified: res.lastModified, size: res.size, hash: hashString(text) };
      this._relanguage(doc);
      this.emit('tree-changed', { path });
      return true;
    }
    if (typeof window.showSaveFilePicker === 'function') {
      const handle = await window.showSaveFilePicker({ suggestedName: doc.name });
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      await this.recovery.remove(doc.key);
      Object.assign(doc, { kind: 'handle', fileHandle: handle, name: handle.name, key: `handle::${uid()}` });
      this._relanguage(doc);
      return true;
    }
    // Last resort: download a copy.
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = doc.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    if (doc.kind === 'untitled') doc.kind = 'download';
    return true;
  }

  _relanguage(doc) {
    const lang = languageForName(doc.name);
    if (lang.id === doc.lang.id) return;
    doc.lang = lang;
    this.reconfigure(() => comp.langData.reconfigure(langDataExtension(lang.id, this.userSnippets)), doc.id);
    this._loadLanguageFor(doc);
    this.emit('active', { pane: this.pane, doc: this.activeDoc });
  }

  async saveAll() {
    let ok = 0, failed = 0;
    for (const doc of [...this.docs.values()].filter((d) => d.dirty)) {
      if (await this.save(doc.id, { quiet: true })) ok++; else failed++;
    }
    if (ok || failed) this.ui.toast(`Saved ${ok} file${ok === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`, failed ? 'warn' : 'success');
    return failed === 0;
  }

  // ---- closing ----------------------------------------------------------------

  /** @returns {Promise<boolean>} false if the user cancelled */
  async closeTab(paneIndex, docId, { force = false } = {}) {
    const pane = this.panes[paneIndex];
    const doc = this.docs.get(docId);
    if (!pane || !doc || !pane.tabs.includes(docId)) return true;
    const elsewhere = this.panes.some((p) => p && p !== pane && p.tabs.includes(docId));
    if (doc.dirty && !elsewhere && !force) {
      if (pane.activeId !== docId) this.showDoc(paneIndex, docId, { focus: false });
      const choice = await this.ui.choose({
        title: 'Unsaved changes',
        message: `Save changes to ${doc.name} before closing?`,
        buttons: [{ id: 'save', label: 'Save', kind: 'primary' }, { id: 'discard', label: "Don't save", kind: 'danger' }, { id: 'cancel', label: 'Cancel' }],
      });
      if (choice === 'cancel' || choice == null) return false;
      if (choice === 'save' && !(await this.save(docId))) return false;
      if (choice === 'discard') await this.recovery.remove(doc.key);
    }
    const idx = pane.tabs.indexOf(docId);
    pane.tabs.splice(idx, 1);
    pane.states.delete(docId);
    pane.scroll.delete(docId);
    if (pane.activeId === docId) {
      pane.activeId = null;
      const next = pane.tabs[Math.min(idx, pane.tabs.length - 1)];
      if (next != null) this.showDoc(paneIndex, next, { focus: false });
      else {
        pane.view.setState(EditorState.create({ doc: '' }));
        pane.view.dom.classList.add('is-empty');
        this.emit('active', { pane, doc: null });
      }
    }
    if (!elsewhere) {
      this.docs.delete(docId);
      clearTimeout(this.autosaveTimers.get(docId));
    }
    this.emit('docs', {});
    this.saveSessionSoon();
    return true;
  }

  async closeOthers(paneIndex, keepId) {
    const pane = this.panes[paneIndex];
    for (const id of pane.tabs.filter((t) => t !== keepId)) {
      if (!(await this.closeTab(paneIndex, id))) return false;
    }
    return true;
  }

  async closeAll({ force = false, keepUntitled = false } = {}) {
    for (const pane of this.panes) {
      if (!pane) continue;
      for (const id of [...pane.tabs]) {
        const doc = this.docs.get(id);
        if (keepUntitled && doc && doc.kind !== 'project') continue;
        // Dirty project buffers stay safe in the recovery store when switching
        // projects; they come back next time that project opens.
        if (doc && doc.dirty && doc.kind === 'project') await this.recovery.flush(doc.key);
        if (!(await this.closeTab(pane.index, id, { force: force || (doc && doc.kind === 'project') }))) return false;
      }
    }
    return true;
  }

  // ---- split -------------------------------------------------------------------

  /** Opens the active document in the second pane too. */
  split(host, { copyActive = true } = {}) {
    if (!this.panes[1]) this.attachPane(1, host);
    const p1 = this.panes[1];
    p1.visible = true;
    const doc = this.activeDoc;
    if (copyActive && doc && !p1.tabs.includes(doc.id)) {
      const st = this.stateOf(doc.id);
      this._addToPane(p1, doc, { selection: st ? { anchor: st.selection.main.anchor, head: st.selection.main.head } : undefined, activate: false });
      this.showDoc(1, doc.id, { focus: false });
    }
    this.activePane = 1;
    this.emit('split', { on: true });
    this.saveSessionSoon();
    return p1;
  }

  async unsplit() {
    const p1 = this.panes[1];
    if (!p1) return;
    // Documents only open on the right move to the left instead of prompting.
    for (const id of [...p1.tabs]) {
      if (!this.panes[0].tabs.includes(id)) {
        const st = p1.stateOf(id);
        this.panes[0].states.set(id, st);
        this.panes[0].tabs.push(id);
      }
    }
    p1.tabs = [];
    p1.states.clear();
    p1.activeId = null;
    p1.view.setState(EditorState.create({ doc: '' }));
    p1.visible = false;
    this.activePane = 0;
    if (this.panes[0].activeId == null && this.panes[0].tabs.length) this.showDoc(0, this.panes[0].tabs[0]);
    this.emit('split', { on: false });
    this.emit('docs', {});
    this.saveSessionSoon();
  }

  moveTab(fromPane, docId, toPane) {
    const target = this.panes[toPane];
    if (!target) return;
    const st = this.stateOf(docId);
    if (!target.tabs.includes(docId)) {
      this._addToPane(target, this.docs.get(docId), { selection: { anchor: st.selection.main.anchor, head: st.selection.main.head } });
    }
    this.showDoc(toPane, docId);
    this.closeTab(fromPane, docId, { force: true });
  }

  // ---- toggles & settings -------------------------------------------------------

  setWrap(docId, on) {
    const doc = this.docs.get(docId);
    if (!doc) return;
    doc.wrap = on;
    this.reconfigure(() => comp.wrap.reconfigure(wrapExtension(on)), docId);
    this.emit('active', { pane: this.pane, doc: this.activeDoc });
  }

  setLocked(docId, locked) {
    const doc = this.docs.get(docId);
    if (!doc) return;
    doc.locked = locked;
    this.reconfigure(() => comp.readOnly.reconfigure(readOnlyExtension(locked || !!doc.readOnlyReason)), docId);
    this.emit('active', { pane: this.pane, doc: this.activeDoc });
  }

  setIndent(docId, indent) {
    const doc = this.docs.get(docId);
    if (!doc) return;
    doc.indent = { ...doc.indent, ...indent };
    doc.indentSource = 'manual';
    this.reconfigure(() => comp.indent.reconfigure(indentExtension(doc.indent)), docId);
    this.emit('active', { pane: this.pane, doc: this.activeDoc });
  }

  setEol(docId, eol) {
    const doc = this.docs.get(docId);
    if (!doc || doc.format.eol === eol) return;
    doc.format = { ...doc.format, eol, mixedEol: false };
    // Changing line endings is a real change to the file: mark dirty.
    doc.dirty = true;
    doc.saved = Text.of(['\u0000eol-changed']);
    this.recovery.schedule(doc.key, () => this._recoveryEntry(doc));
    this.emit('docs', { doc });
    this.emit('active', { pane: this.pane, doc: this.activeDoc });
  }

  setLanguage(docId, langId) {
    const doc = this.docs.get(docId);
    if (!doc) return;
    doc.lang = languageById(langId);
    doc.degrade = { ...doc.degrade, highlight: true };
    this.reconfigure(() => [comp.langData.reconfigure(langDataExtension(langId, this.userSnippets)), comp.language.reconfigure([]), comp.lint.reconfigure([])], docId);
    this._loadLanguageFor(doc);
    this.emit('active', { pane: this.pane, doc: this.activeDoc });
  }

  applySettings(prev, next) {
    if (prev.lineNumbers !== next.lineNumbers) this.reconfigure(() => comp.lineNumbers.reconfigure(lineNumbersExtension(next.lineNumbers)));
    if (prev.autoCloseBrackets !== next.autoCloseBrackets) this.reconfigure(() => comp.closeBrackets.reconfigure(closeBracketsExtension(next.autoCloseBrackets)));
    if (prev.stickyScroll !== next.stickyScroll) this.reconfigure(() => comp.sticky.reconfigure(stickyExtension(next.stickyScroll)));
    if (prev.fastScroll !== next.fastScroll) this.reconfigure(() => comp.fastScroll.reconfigure(fastScrollExtension(next.fastScroll)));
    if (prev.tabWidth !== next.tabWidth || prev.insertSpaces !== next.insertSpaces) {
      this.reconfigure((doc) => {
        if (doc.indentSource !== 'settings') return null;
        doc.indent = { insertSpaces: next.insertSpaces, indentSize: next.tabWidth, tabWidth: next.tabWidth };
        return comp.indent.reconfigure(indentExtension(doc.indent));
      });
    }
    if (prev.userSnippets !== next.userSnippets) {
      const parsed = parseUserSnippets(next.userSnippets);
      if (parsed.error) this.ui.toast(parsed.error, 'error');
      this.userSnippets = parsed.snippets;
      this.reconfigure((doc) => comp.langData.reconfigure(langDataExtension(doc.lang.id, this.userSnippets)));
    }
    for (const p of this.panes) if (p) p.view.requestMeasure();
  }

  // ---- external changes (spec §3.4, §2 Phase 2) ----------------------------------

  async checkExternalChanges() {
    if (this._checking) return;
    this._checking = true;
    try {
      for (const doc of [...this.docs.values()]) {
        if (doc.kind !== 'project' || !this.project) continue;
        let st;
        try { st = await this.project.fs.stat(doc.path); } catch { continue; }
        if (!st) {
          if (doc.disk) {
            doc.disk = null;
            doc.deletedOnDisk = true;
            this.ui.toast(`${doc.path} was deleted outside the editor. Save to recreate it.`, 'warn');
            doc.dirty = true;
            this.emit('docs', { doc });
          }
          continue;
        }
        if (doc.disk && st.lastModified === doc.disk.lastModified && st.size === doc.disk.size) continue;
        const { info, disk } = await this._readDoc(doc.path);
        const diskText = info.text.replace(/\r\n?/g, '\n');
        if (doc.disk && disk.hash === doc.disk.hash) { doc.disk = disk; continue; }
        doc.disk = disk;
        doc.deletedOnDisk = false;
        if (!doc.dirty) {
          const current = this.textOf(doc.id);
          const ch = minimalChange(current, diskText);
          doc.saved = Text.of(diskText.split('\n'));
          doc.format = { encoding: info.encoding, bom: info.bom, eol: info.eol, mixedEol: info.mixedEol };
          if (ch) this.dispatchToDoc(doc.id, { changes: ch, annotations: [externalAnno.of('reload'), Transaction.addToHistory.of(true)] });
          this.ui.toast(`Reloaded ${doc.name} (changed outside the editor).`, 'info');
          this._loadGitBase(doc);
        } else {
          doc.conflict = { reason: 'external', diskText, diskFormat: { encoding: info.encoding, bom: info.bom, eol: info.eol, mixedEol: info.mixedEol } };
          this.emit('conflict', { doc });
        }
      }
    } finally {
      this._checking = false;
    }
  }

  /** Resolves a conflict: 'disk' loads the disk version, 'mine' keeps the buffer. */
  resolveConflict(docId, choice) {
    const doc = this.docs.get(docId);
    if (!doc || !doc.conflict) return;
    if (choice === 'disk') {
      const diskText = doc.conflict.diskText;
      const ch = minimalChange(this.textOf(doc.id), diskText);
      doc.saved = Text.of(diskText.split('\n'));
      if (doc.conflict.diskFormat) doc.format = doc.conflict.diskFormat;
      if (ch) this.dispatchToDoc(doc.id, { changes: ch, annotations: externalAnno.of('reload') });
      else { doc.dirty = false; this.recovery.remove(doc.key); }
    } else {
      // "Keep mine": the disk version becomes the new baseline for the
      // overwrite check, so the next save goes through without asking again.
      doc.saved = Text.of(doc.conflict.diskText.split('\n'));
      const st = this.stateOf(doc.id);
      doc.dirty = !sameText(st.doc, doc.saved);
    }
    doc.conflict = null;
    this.emit('conflict', { doc });
    this.emit('docs', { doc });
  }

  // ---- file tree hooks -----------------------------------------------------------

  onPathRenamed(from, to) {
    for (const doc of this.docs.values()) {
      if (doc.kind !== 'project') continue;
      if (doc.path === from || doc.path.startsWith(from + '/')) {
        const oldKey = doc.key;
        const newPath = to + doc.path.slice(from.length);
        doc.path = newPath;
        doc.name = basename(newPath);
        doc.key = `${this.project.meta.id}::${newPath}`;
        this.history.rekey(oldKey, doc.key, newPath).catch(() => {});
        if (doc.dirty) { this.recovery.remove(oldKey); this.recovery.schedule(doc.key, () => this._recoveryEntry(doc)); }
        this.nav.removePath(from, to);
        this._relanguage(doc);
      }
    }
    this.editorConfigCache.clear();
    this.emit('docs', {});
    this.saveSessionSoon();
  }

  async onPathDeleted(path) {
    for (const doc of [...this.docs.values()]) {
      if (doc.kind !== 'project' || !(doc.path === path || doc.path.startsWith(path + '/'))) continue;
      if (doc.dirty) {
        // Keep unsaved work: it becomes an untitled buffer.
        await this.recovery.remove(doc.key);
        Object.assign(doc, { kind: 'untitled', restoredFrom: doc.path, path: null, key: `untitled::${uid()}` });
        this.recovery.schedule(doc.key, () => this._recoveryEntry(doc));
      } else {
        for (const p of this.panes) if (p && p.tabs.includes(doc.id)) await this.closeTab(p.index, doc.id, { force: true });
      }
      this.nav.removePath(path);
    }
    this.editorConfigCache.clear();
    this.emit('docs', {});
  }

  allDocs() {
    return [...this.docs.values()];
  }

  dirtyDocs() {
    return this.allDocs().filter((d) => d.dirty);
  }
}
