// editor.js
//
// WHY CODEMIRROR 6 (and not a hand-built canvas editor, and not Monaco):
// - Hand-building a text editor (custom cursor, line rendering, input
//   handling) is a real, valuable exercise — the original Android version
//   of this project does exactly that. But it's weeks of work before you
//   have anything usable. You asked for a working baseline first; we can
//   still do a "build your own mini text editor" as a standalone learning
//   module later, without it blocking the real app.
// - Monaco (VS Code's editor) is the other obvious choice, but it's a much
//   heavier bundle (5MB+) and its touch/mobile input handling is not great —
//   both matter a lot for something you're shipping to a phone.
// - CodeMirror 6 is modular (you only bundle what you use), has first-class
//   mobile input support, and its parser (Lezer) already does incremental
//   re-parsing on edits — the same core idea tree-sitter brings to the
//   Android version, just a different parser library for the web.
//
// WHY A "Compartment" FOR LANGUAGE/THEME:
// CodeMirror extensions are normally fixed when you create an editor. A
// Compartment is a slot you can reconfigure later (e.g. swapping the
// language extension when the user switches from a .js tab to a .css tab)
// without tearing down and rebuilding the whole editor view.

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { oneDark } from '@codemirror/theme-one-dark';
import { indentUnit } from '@codemirror/language';
import {
  undo as cmUndo, redo as cmRedo, selectAll as cmSelectAll, indentMore,
  cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown,
} from '@codemirror/commands';

const languageCompartment = new Compartment();
const tabWidthCompartment = new Compartment();
const themeCompartment = new Compartment();

function languageForFilename(name) {
  if (/\.(js|mjs|cjs|jsx)$/i.test(name)) return javascript({ jsx: true });
  if (/\.(html|htm)$/i.test(name)) return html();
  if (/\.css$/i.test(name)) return css();
  return []; // plain text — no language extension
}

/**
 * Manages the set of open tabs and the single CodeMirror view that
 * displays whichever one is active. Each tab keeps its own EditorState,
 * so switching tabs preserves cursor position and undo history per file —
 * that state-per-document, one-view-rendering-it-all pattern is the same
 * approach real multi-document editors use.
 */
export class EditorManager {
  constructor(parentEl, { onDirtyChange, onSettingsNeeded } = {}) {
    this.tabs = new Map(); // id -> { id, name, path, fileHandle, state, dirty, providerKind }
    this.activeId = null;
    this.onDirtyChange = onDirtyChange || (() => {});
    this._nextId = 1;

    this.view = new EditorView({
      state: this._buildState('', []),
      parent: parentEl,
    });
  }

  _buildState(content, extraExtensions) {
    return EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        languageCompartment.of(extraExtensions),
        themeCompartment.of(oneDark),
        tabWidthCompartment.of(indentUnit.of(' '.repeat(this.tabWidth || 2))),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && this.activeId != null) {
            const tab = this.tabs.get(this.activeId);
            if (tab && !tab.dirty) {
              tab.dirty = true;
              this.onDirtyChange(tab.id, true);
            }
          }
        }),
      ],
    });
  }

  openTab({ name, path, content, fileHandle, providerKind }) {
    // If this path is already open, just switch to it instead of duplicating.
    for (const tab of this.tabs.values()) {
      if (tab.path === path) {
        this.switchTo(tab.id);
        return tab.id;
      }
    }
    const id = this._nextId++;
    const langExt = languageForFilename(name);
    const state = this._buildState(content, langExt);
    this.tabs.set(id, { id, name, path, fileHandle, providerKind, state, dirty: false });
    this.switchTo(id);
    return id;
  }

  switchTo(id) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (this.activeId != null) {
      const prev = this.tabs.get(this.activeId);
      if (prev) prev.state = this.view.state; // persist cursor/undo history
    }
    this.activeId = id;
    this.view.setState(tab.state);
  }

  closeTab(id) {
    this.tabs.delete(id);
    if (this.activeId === id) {
      this.activeId = null;
      const next = this.tabs.keys().next();
      if (!next.done) this.switchTo(next.value);
      else this.view.setState(this._buildState('', []));
    }
  }

  getActiveTab() {
    return this.activeId != null ? this.tabs.get(this.activeId) : null;
  }

  getContent(id = this.activeId) {
    const tab = this.tabs.get(id);
    if (!tab) return '';
    return tab.id === this.activeId ? this.view.state.doc.toString() : tab.state.doc.toString();
  }

  markSaved(id) {
    const tab = this.tabs.get(id);
    if (tab) {
      tab.dirty = false;
      this.onDirtyChange(id, false);
    }
  }

  setTheme(dark) {
    this.view.dispatch({ effects: themeCompartment.reconfigure(dark ? oneDark : []) });
  }

  setFontSize(px) {
    this.view.dom.style.fontSize = px + 'px';
  }

  setTabWidth(n) {
    this.tabWidth = n;
    this.view.dispatch({ effects: tabWidthCompartment.reconfigure(indentUnit.of(' '.repeat(n))) });
  }

  // ---- Commands used by the tablet keys bar (see keysBar.js) -------------
  // These wrap CodeMirror's own command functions, which all take the
  // EditorView directly (they read view.state and call view.dispatch
  // internally) — no separate "get state, apply, set state" dance needed.

  undo() { cmUndo(this.view); this.view.focus(); }
  redo() { cmRedo(this.view); this.view.focus(); }
  selectAll() { cmSelectAll(this.view); this.view.focus(); }
  indent() { indentMore(this.view); this.view.focus(); }

  insertText(text) {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    this.view.focus();
  }

  moveCursor(direction) {
    const fn = { left: cursorCharLeft, right: cursorCharRight, up: cursorLineUp, down: cursorLineDown }[direction];
    if (fn) fn(this.view);
    this.view.focus();
  }
}
