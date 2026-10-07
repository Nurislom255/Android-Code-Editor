// core/navHistory.js — back/forward navigation across files (spec §2 Phase 2).
//
// Like a browser's history, but for cursor locations: jumping to a definition,
// a search result or another file records where you were, so "Back" returns
// there. Small cursor moves inside the same area replace the top entry instead
// of piling up, otherwise Back would step through every keystroke.

export class NavHistory {
  constructor({ max = 50, nearLines = 8 } = {}) {
    this.max = max;
    this.nearLines = nearLines;
    this.stack = [];
    this.index = -1; // points at the current location
  }

  /** @param {{path:string, line:number, pos?:number}} loc */
  push(loc) {
    const cur = this.stack[this.index];
    if (cur && cur.path === loc.path && Math.abs(cur.line - loc.line) <= this.nearLines) {
      this.stack[this.index] = loc;
      return;
    }
    this.stack.splice(this.index + 1); // a new jump discards the forward branch
    this.stack.push(loc);
    if (this.stack.length > this.max) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  /** Updates the current entry without creating a new one (cursor moved). */
  updateCurrent(loc) {
    const cur = this.stack[this.index];
    if (cur && cur.path === loc.path) this.stack[this.index] = loc;
    else this.push(loc);
  }

  canBack() { return this.index > 0; }
  canForward() { return this.index < this.stack.length - 1; }

  back() {
    if (!this.canBack()) return null;
    return this.stack[--this.index];
  }

  forward() {
    if (!this.canForward()) return null;
    return this.stack[++this.index];
  }

  /** Drops entries for a file that was deleted or renamed. */
  removePath(path, renamedTo = null) {
    if (renamedTo) {
      for (const e of this.stack) if (e.path === path) e.path = renamedTo;
      return;
    }
    const cur = this.stack[this.index];
    this.stack = this.stack.filter((e) => e.path !== path);
    this.index = cur ? Math.min(this.stack.length - 1, Math.max(0, this.stack.indexOf(cur))) : this.stack.length - 1;
    if (this.stack.length === 0) this.index = -1;
  }
}
