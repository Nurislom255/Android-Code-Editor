// core/keysLayout.js — what is on the keys bar (spec §2, §3.1; ROADMAP Phase 2).
//
// Symbol layouts are plain strings so users can edit them in Settings
// (toolbar customization is *data*, not a plugin). Tokens are separated by
// spaces; a token lists a key and its variants separated by "^":
//
//   "("             tap → (
//   "(^)"           tap → (   swipe up or hold → )
//   "(^)^[]^{}"     tap → (   swipe up → )   down → []   left → {}   hold → pick any
//   "+^-^*^/^**^%"  …and the fourth variant (**) is swipe right
//
// A "^" only separates when it has text on both sides, so "^" alone is the
// caret key and "|^^" is "|" with "^" as its variant.

// The operator key is on the main row of every code layout: tap +, swipe up -,
// down *, left /, right ** (power) — hold for the rest. C-like languages have
// no power operator (C++: pow(a, b) from <cmath>; "^" is XOR there and in JS
// and Python too), so their right swipe is % (remainder).
const OPS = '+^-^*^/^%^=^<^>^!^&^|^^';
const OPS_POW = '+^-^*^/^**^%^=^<^>^!^&^|^^';
const OPS_PY = '+^-^*^/^**^%^//^=^<^>^!^&^|^^';

export const DEFAULT_LAYOUTS = Object.freeze({
  // The first three are on the phone's main row, the first six on a tablet;
  // the rest fill the context row when it has room, and all are in "More".
  js: `(^)^[]^{} ;^:^, ${OPS_POW} {^}^\${} =^=>^=== "^'^\` .^,^?. [^] <^> !^? &^|^&& _^# \\^% @^~`,
  html: '<^>^</ /^\\ =^" "^\'^` {^} (^) !^- #^. :^; &^@ [^] _^* +^%',
  css: '{^} :^; .^# (^) -^_ %^! "^\' ,^> *^+ [^] @^& /^= ~^$',
  python: `:^= (^)^[]^{} ${OPS_PY} "^'^""" [^] {^} _^# .^, =^== <^> !^? @^% \\^|`,
  clike: `;^:^:: (^)^[]^{}^<> ${OPS} {^} [^] =^== "^'^\\n <^> &^* .^, ->^:: !^? |^^ #^_`,
  markdown: '#^* -^+ `^~^``` [^] (^) *^_ >^| !^? :^; "^\' \\^/ <^> =^&',
  json: '{^} [^] "^: ,^. -^+ true^false null^0 \\^/',
  plain: `(^)^[]^{} ${OPS} "^'^\` [^] {^} ;^: .^, -^_ =^+ /^\\ !^? @^# &^| *^%`,
});

/**
 * Defaults of earlier versions. Saved settings contain the whole layouts, so
 * a layout still equal to an old default is replaced by the new default
 * (one the owner edited is kept).
 */
export const LEGACY_DEFAULT_LAYOUTS = Object.freeze([{
  // v2.3.0
  js: `(^)^[]^{} ;^:^, ${OPS} {^}^\${} =^=>^=== "^'^\` .^,^?. [^] <^> !^? &^|^&& _^# \\^% @^~`,
  python: `:^= (^)^[]^{} ${OPS} "^'^""" [^] {^} _^# .^, =^== <^> !^? @^% \\^|`,
}, {
  // v2.2.0
  js: '(^)^[]^{} {^}^${} ;^:^, =^=>^=== "^\'^` .^,^?. [^] <^> !^? &^|^&& +^-^++ *^/^% _^# \\^% @^~',
  python: ':^= (^)^[]^{} "^\'^""" [^] {^} _^# .^, =^== *^/ +^- <^> !^? @^% \\^|',
  clike: ';^:^:: {^} (^)^[]^{}^<> [^] =^== "^\'^\\n <^> &^* .^, ->^:: !^? +^- /^% |^^ #^_',
  plain: '(^)^[]^{} [^] {^} "^\'^` ;^: .^, -^_ =^+ /^\\ !^? @^# &^| *^%',
  markdown: '#^* -^+ `^~^``` [^] (^) *^_ >^| !^? :^; "^\' \\^/ <^> =^&',
  html: '<^>^</ /^\\ =^" "^\'^` {^} (^) !^- #^. :^; &^@ [^] _^* +^%',
}, {
  js: '{^} (^) [^] ;^: =^=> "^\' `^$ .^, <^> !^? &^| +^- *^/ _^# \\^% @^~',
  html: '<^> /^\\ =^" "^\' {^} (^) !^- #^. :^; &^@ [^] _^* +^%',
  css: '{^} :^; .^# (^) -^_ %^! "^\' ,^> *^+ [^] @^& /^= ~^$',
  python: ':^= (^) [^] {^} "^\' _^# .^, =^== *^/ +^- <^> !^? @^% \\^|',
  clike: '{^} (^) ;^: [^] =^== "^\' <^> &^* .^, ->^:: !^? +^- /^% |^^ #^_',
  markdown: '#^* -^+ `^~ [^] (^) *^_ >^| !^? :^; "^\' \\^/ <^> =^&',
  json: '{^} [^] "^: ,^. -^+ true^false null^0 \\^/',
  plain: '(^) [^] {^} "^\' ;^: .^, -^_ =^+ /^\\ !^? @^# &^| *^%',
}]);

export const LANGUAGE_GROUPS = Object.freeze({
  javascript: 'js', typescript: 'js', jsx: 'js', tsx: 'js',
  html: 'html', xml: 'html', svg: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  python: 'python',
  c: 'clike', cpp: 'clike', java: 'clike', kotlin: 'clike', csharp: 'clike', go: 'clike', rust: 'clike', swift: 'clike', dart: 'clike', php: 'clike',
  markdown: 'markdown',
  json: 'json',
});

export function groupForLanguage(langId) {
  return LANGUAGE_GROUPS[langId] || 'plain';
}

/** @returns {{label:string, insert:string, alt:string|null, alts:string[]}[]} */
export function parseLayout(layout) {
  return layout.trim().split(/\s+/).filter(Boolean).map(parseToken);
}

export function parseToken(token) {
  const parts = [];
  let start = 0;
  for (let i = 1; i < token.length - 1; i++) {
    if (token[i] === '^' && i > start) {
      parts.push(token.slice(start, i));
      start = i + 1;
      i++; // the next character starts a variant, even if it is "^"
    }
  }
  parts.push(token.slice(start));
  const [primary, ...alts] = parts;
  return { label: primary, insert: primary, alt: alts[0] || null, alts };
}

/**
 * Why a symbol key can't be made of these fields — [tap, up, down, left,
 * right] and the hold-only ones — or null.
 */
export function tokenProblem(vals, extra = []) {
  if (!vals[0]) return 'A tap must type something.';
  const swipes = vals.slice(1);
  const lastSet = swipes.map(Boolean).lastIndexOf(true);
  if (swipes.slice(0, lastSet).some((v) => !v)) return 'Fill the swipes in order (up, down, left, right): no gaps.';
  for (const v of [...vals.filter(Boolean), ...extra]) {
    if (/\s/.test(v)) return 'No spaces inside a key.';
    if (v.length > 1 && v.includes('^')) return '^ can only be a key on its own.';
  }
  const parts = [vals[0], ...swipes.filter(Boolean), ...extra];
  const k = parseToken(parts.join('^'));
  if (k.insert !== parts[0] || k.alts.join('\u0000') !== parts.slice(1).join('\u0000')) return 'These can\'t be combined into one key.';
  return null;
}

export function formatLayout(keys) {
  return keys.map((k) => [k.insert, ...(k.alts || (k.alt ? [k.alt] : []))].join('^')).join(' ');
}

/**
 * Pairs inserted as a unit with the cursor in between, when auto-close is on
 * (matches what typing "(" does with closeBrackets).
 */
export const AUTO_PAIRS = Object.freeze({ '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' });

/**
 * What a finger dragging on a key is doing.
 *   dx    horizontal movement, px (right is positive)
 *   dyUp  vertical movement, px (UP is positive)
 *   sideways  the key has left / right variants too
 * → 'none' (not decided yet / a small wobble), 'up' or 'down' (a swipe: a
 *   leaning or curved one counts, up to ~63° from vertical), or 'pan'
 *   (mostly sideways). With `sideways`, 'left' / 'right' instead of 'pan';
 *   up / down still get a little more room (~51° from vertical): thumbs
 *   swipe up in an arc.
 */
export function classifyKeyDrag(dx, dyUp, sideways = false) {
  if (Math.hypot(dx, dyUp) < 8) return 'none';
  if (sideways) return Math.abs(dyUp) >= Math.abs(dx) * 0.8 ? (dyUp > 0 ? 'up' : 'down') : (dx > 0 ? 'right' : 'left');
  if (Math.abs(dyUp) >= Math.abs(dx) * 0.5) return dyUp > 0 ? 'up' : 'down';
  if (Math.abs(dx) > Math.abs(dyUp)) return 'pan';
  return 'none';
}

/**
 * Puts `next` (best first) into `n` slots so that a key that is still offered
 * keeps the slot it had in `prev`: no reshuffling under the thumb. Keys are
 * compared as strings; empty slots are null.
 */
export function stableSlots(prev, next, n) {
  const want = [];
  for (const k of next) if (k != null && !want.includes(k) && want.length < n) want.push(k);
  const out = new Array(n).fill(null);
  const rest = [];
  for (const k of want) {
    const i = prev.indexOf(k);
    if (i >= 0 && i < n && out[i] === null) out[i] = k;
    else rest.push(k);
  }
  for (let i = 0; i < n && rest.length; i++) if (out[i] === null) out[i] = rest.shift();
  return out;
}

/**
 * Which keys-bar layout fits the device. `screen` sizes are used, not the
 * window's: an open keyboard makes a portrait phone's window wider than tall.
 *   phone      2 rows × 7 keys (portrait phone, two thumbs)
 *   landscape  1 row (landscape phone: the keyboard leaves little room)
 *   tablet     1 row, two clusters at the bottom corners
 */
export function keysProfile({ screenWidth, screenHeight, touch }) {
  if (!touch) return 'tablet';
  if (Math.min(screenWidth, screenHeight) >= 600) return 'tablet';
  return screenWidth > screenHeight ? 'landscape' : 'phone';
}

/**
 * The keys bar of each profile, as rows of key ids (Settings → Keys bar):
 *   tab joystick mod line cursors undo more esc ctrl shift alt   the special keys
 *   ctx       a context key (follows the code)
 *   sym       the language's next symbol key (its layout above)
 *   @name     an action key (ACTION_KEYS)
 *   s:token   a fixed symbol key, e.g. "s:;" or "s:(^)^[]"
 * The tablet's two rows are the left and right ends of its one row.
 * Only the profiles the owner changed are stored; the rest follow these.
 */
export const DEFAULT_BAR = Object.freeze({
  phone: [['mod', 'ctx', 'ctx', 'ctx', 'ctx', 'cursors', 'more'], ['tab', 'joystick', 'sym', 'sym', 'sym', 'line', 'undo']],
  landscape: [['tab', 'joystick', 'mod', 'ctx', 'ctx', 'ctx', 'ctx', 'sym', 'sym', 'sym', 'line', 'cursors', 'undo', 'more']],
  tablet: [['esc', 'tab', 'joystick', 'ctrl', 'shift', 'alt'],
    ['ctx', 'ctx', 'ctx', 'ctx', 'ctx', 'ctx', 'sym', 'sym', 'sym', 'sym', 'sym', 'sym', 'line', 'cursors', 'undo', 'more']],
});

export const BAR_KEYS = Object.freeze({
  tab: ['Tab', 'Tab · swipe up / hold: Shift+Tab'],
  joystick: ['◉', 'Joystick: moves the cursor'],
  mod: ['Mod', 'Ctrl · Shift · Alt · Esc · Home · End'],
  ctx: ['ctx', 'Context key: changes with the code'],
  sym: ['sym', "The language's next symbol key"],
  line: ['↵', 'Line actions: new line, move, duplicate…'],
  cursors: ['⫶', 'Multi-cursor'],
  undo: ['↶', 'Undo · swipe up / hold: Redo'],
  more: ['⋯', 'All keys'],
  esc: ['Esc', 'Escape'],
  ctrl: ['Ctrl', 'Ctrl (one-shot, double tap locks)'],
  shift: ['Shift', 'Shift'],
  alt: ['Alt', 'Alt'],
});

export const BAR_PROFILES = Object.freeze({
  phone: { name: 'Phone', rows: ['Top row', 'Bottom row'], max: 8 },
  landscape: { name: 'Phone, sideways', rows: ['Row'], max: 18 },
  tablet: { name: 'Tablet', rows: ['Left end', 'Right end'], max: 22 },
});

/**
 * The bar id of a key in the "More" catalog or a symbol layout: "@name" is an
 * action key only when that action exists — "@" and "@^~" are symbols.
 */
export function catalogId(k) {
  return k.startsWith('@') && ACTION_KEYS[k.slice(1)] ? k : `s:${k}`;
}

/** A key id's name and description, for the editor and tooltips. */
export function barKeyInfo(id) {
  if (BAR_KEYS[id]) return { label: BAR_KEYS[id][0], title: BAR_KEYS[id][1] };
  if (id.startsWith('@') && ACTION_KEYS[id.slice(1)]) { const [label, title] = ACTION_KEYS[id.slice(1)]; return { label, title }; }
  if (id.startsWith('s:')) { const k = parseToken(id.slice(2)); return { label: k.label, title: `Symbol ${k.label}${k.alts.length ? ` (${k.alts.join(' ')})` : ''}` }; }
  return null;
}

const validBarKey = (id) => typeof id === 'string' && (!!BAR_KEYS[id] || (id.startsWith('@') && !!ACTION_KEYS[id.slice(1)])
  || (/^s:\S{1,40}$/.test(id)));

/** Why `rows` can't be the bar of `profile` — or null when it can. */
export function barProblem(rows, profile) {
  const p = BAR_PROFILES[profile];
  if (!p || !Array.isArray(rows) || rows.length !== p.rows.length) return 'Wrong number of rows.';
  for (const r of rows) {
    if (!Array.isArray(r) || !r.length) return 'A row is empty.';
    if (r.length > p.max) return `At most ${p.max} keys a row.`;
    if (!r.every(validBarKey)) return 'Unknown key.';
  }
  const all = rows.flat();
  if (!all.includes('tab')) return 'Tab must stay on the bar.';
  if (!all.includes('more')) return '⋯ (all keys) must stay on the bar: it is the way to every other key.';
  if (!all.includes('mod') && !['ctrl', 'shift', 'alt'].every((m) => all.includes(m))) return 'Keep Mod, or Ctrl, Shift and Alt.';
  return null;
}

/** The stored bar changes, keeping only valid profiles. */
export function normalizeBar(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const profile of Object.keys(BAR_PROFILES)) {
    const rows = raw[profile];
    if (rows && !barProblem(rows, profile)) out[profile] = rows.map((r) => r.slice());
  }
  return out;
}

/** The bar of `profile`: the owner's, else the default. */
export function barFor(custom, profile) {
  return (custom && custom[profile]) || DEFAULT_BAR[profile] || DEFAULT_BAR.phone;
}

/**
 * "Pin" a key from the All-keys sheet: it takes the place of the last
 * context key, else joins the row that has room (⋯'s row first).
 * → the new rows, or null when the bar is full.
 */
export function pinToBar(rows, profile, id) {
  const next = rows.map((r) => r.slice());
  for (let i = next.length - 1; i >= 0; i--) {
    const j = next[i].lastIndexOf('ctx');
    if (j >= 0) { next[i][j] = id; return next; }
  }
  const max = BAR_PROFILES[profile].max;
  const order = [next.findIndex((r) => r.includes('more')), ...next.keys()];
  for (const i of order) {
    if (i >= 0 && next[i].length < max) {
      const at = next[i].indexOf('more');
      next[i].splice(at >= 0 ? at : next[i].length, 0, id);
      return next;
    }
  }
  return null;
}

/**
 * Action keys, by command name: [key label, description]. The command runs
 * through the app's command table, which also knows its keyboard shortcut.
 */
export const ACTION_KEYS = Object.freeze({
  tab: ['Tab', 'Tab / indent / accept suggestion'],
  outdent: ['⇤', 'Outdent (Shift+Tab)'],
  indent: ['⇥', 'Indent'],
  newlineBelow: ['↵', 'New line below'],
  newlineAbove: ['↥', 'New line above'],
  lineUp: ['⇡Ln', 'Move line up'],
  lineDown: ['⇣Ln', 'Move line down'],
  duplicateLine: ['Dup', 'Duplicate line'],
  copyLineUp: ['Dup↑', 'Copy line up'],
  joinLines: ['Join', 'Join with the next line'],
  deleteLine: ['✕Ln', 'Delete line'],
  completeStatement: ['⏎;', 'Complete statement: add ; (or : / { }) and start a new line'],
  toggleComment: ['//', 'Toggle comment'],
  addCursorDown: ['+⇣', 'Add a cursor on the line below'],
  addCursorUp: ['+⇡', 'Add a cursor on the line above'],
  cursorsOnLines: ['⫶', 'A cursor on each selected line'],
  selectNext: ['Sel+', 'Select the next occurrence'],
  selectAllMatches: ['Sel*', 'Select all occurrences'],
  escape: ['Esc', 'Escape: close the list / panel, back to one cursor'],
  selectAll: ['All', 'Select all'],
  selectLine: ['Line', 'Select line'],
  expandSelection: ['⊕', 'Expand selection (word → expression → block)'],
  shrinkSelection: ['⊖', 'Shrink selection'],
  cut: ['Cut', 'Cut'],
  copy: ['Copy', 'Copy'],
  paste: ['Paste', 'Paste'],
  lineStart: ['Home', 'Line start'],
  lineEnd: ['End', 'Line end'],
  docStart: ['Top', 'Start of the file'],
  docEnd: ['Bottom', 'End of the file'],
  pageUp: ['PgUp', 'Page up'],
  pageDown: ['PgDn', 'Page down'],
  matchingBracket: ['{↔}', 'Go to the matching bracket'],
  goToLine: ['Ln#', 'Go to line'],
  backspace: ['⌫', 'Backspace'],
  deleteForward: ['⌦', 'Delete'],
  undo: ['↶', 'Undo'],
  redo: ['↷', 'Redo'],
  format: ['Fmt', 'Format document'],
  find: ['Find', 'Find / replace'],
  save: ['Save', 'Save'],
  quickOpen: ['Open', 'Go to file'],
  hideKeyboard: ['⌨↓', 'Hide keyboard'],
});

/** The "More" sheet: every key, grouped. "@name" is an action key. */
export const MORE_GROUPS = Object.freeze([
  ['Lines', ['@newlineBelow', '@newlineAbove', '@lineUp', '@lineDown', '@duplicateLine', '@copyLineUp', '@joinLines', '@deleteLine', '@completeStatement', '@toggleComment']],
  ['Cursors', ['@addCursorDown', '@addCursorUp', '@cursorsOnLines', '@selectNext', '@selectAllMatches', '@escape']],
  ['Selection', ['@selectAll', '@selectLine', '@expandSelection', '@shrinkSelection', '@cut', '@copy', '@paste']],
  ['Navigation', ['@lineStart', '@lineEnd', '@docStart', '@docEnd', '@pageUp', '@pageDown', '@matchingBracket', '@goToLine']],
  ['Editing', ['@tab', '@outdent', '@indent', '@backspace', '@deleteForward', '@undo', '@redo', '@format', '@find', '@save', '@hideKeyboard']],
  ['Brackets & quotes', ['(', ')', '[', ']', '{', '}', '<', '>', '"', "'", '`']],
  ['Operators', ['=', '==', '!=', '+', '-', '*', '/', '%', '**', '&', '|', '&&', '||', '!', '?', ':', ';', ',', '.', '->', '::', '=>', '#', '@', '$', '\\', '^', '~', '_']],
]);

/** With Ctrl armed, the context row offers these (key letter, command). */
export const CTRL_KEYS = Object.freeze([
  ['S', 'save'], ['F', 'find'], ['D', 'selectNext'], ['A', 'selectAll'], ['/', 'toggleComment'], ['G', 'goToLine'],
  ['P', 'quickOpen'], ['X', 'cut'], ['C', 'copy'], ['V', 'paste'], ['Z', 'undo'], ['Y', 'redo'],
]);
