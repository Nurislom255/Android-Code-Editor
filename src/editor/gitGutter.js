// editor/gitGutter.js — added / modified / deleted markers next to the line
// numbers (spec §2 Phase 2), comparing the buffer to the file's version in
// git HEAD. The workspace hands in the HEAD text with `setGitBase`; the diff is
// recomputed a moment after typing stops (core/lineDiff.js).

import { StateField, StateEffect } from '@codemirror/state';
import { gutter, GutterMarker, ViewPlugin } from '@codemirror/view';
import { gutterMarkers } from '../core/lineDiff.js';

export const setGitBase = StateEffect.define();
const setMarkers = StateEffect.define();

const gitField = StateField.define({
  create: () => ({ base: null, byLine: new Map() }),
  update(value, tr) {
    let v = value;
    for (const e of tr.effects) {
      if (e.is(setGitBase)) v = { base: e.value, byLine: v.byLine };
      if (e.is(setMarkers)) v = { base: v.base, byLine: e.value };
    }
    if (v.base === null && v.byLine.size) v = { base: null, byLine: new Map() };
    return v;
  },
});

class Marker extends GutterMarker {
  constructor(kind) { super(); this.kind = kind; }
  eq(other) { return other.kind === this.kind; }
  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-git-${this.kind}`;
    el.title = this.kind === 'added' ? 'Added since last commit' : this.kind === 'modified' ? 'Changed since last commit' : 'Lines deleted below';
    return el;
  }
}
const MARKERS = { added: new Marker('added'), modified: new Marker('modified'), deleted: new Marker('deleted') };

const recompute = ViewPlugin.fromClass(class {
  constructor(view) { this.view = view; this.timer = 0; this.schedule(0); }
  update(u) {
    const baseChanged = u.startState.field(gitField).base !== u.state.field(gitField).base;
    if (u.docChanged || baseChanged) this.schedule(baseChanged ? 0 : 350);
  }
  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const { base } = this.view.state.field(gitField);
      const byLine = new Map();
      if (base !== null) {
        for (const m of gutterMarkers(base, this.view.state.doc.toString())) byLine.set(m.line + 1, m.kind);
      }
      this.view.dispatch({ effects: setMarkers.of(byLine) });
    }, delay);
  }
  destroy() { clearTimeout(this.timer); }
});

export const gitGutter = [
  gitField,
  recompute,
  gutter({
    class: 'cm-git-gutter',
    lineMarker(view, line) {
      const kind = view.state.field(gitField).byLine.get(view.state.doc.lineAt(line.from).number);
      return kind ? MARKERS[kind] : null;
    },
    lineMarkerChange: (u) => u.startState.field(gitField).byLine !== u.state.field(gitField).byLine,
    initialSpacer: () => MARKERS.added,
  }),
];

export function gitBaseOf(state) {
  const f = state.field(gitField, false);
  return f ? f.base : null;
}
