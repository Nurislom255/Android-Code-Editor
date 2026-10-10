// core/keysLayout.js — what is on the keys bar (spec §2, §3.1; ROADMAP Phase 2).
//
// Symbol layouts are plain strings so users can edit them in Settings
// (toolbar customization is *data*, not a plugin). Tokens are separated by
// spaces; a token lists a key and its variants separated by "^":
//
//   "("          tap → (
//   "(^)"        tap → (   swipe up or hold → )
//   "(^)^[]^{}"  tap → (   swipe up → )   swipe down → []   hold → pick any
//
// A "^" only separates when it has text on both sides, so "^" alone is the
// caret key and "|^^" is "|" with "^" as its variant.

export const DEFAULT_LAYOUTS = Object.freeze({
  // The first three are on the phone's main row, the first six on a tablet;
  // the rest fill the context row when it has room, and all are in "More".
  js: '(^)^[]^{} {^}^${} ;^:^, =^=>^=== "^\'^` .^,^?. [^] <^> !^? &^|^&& +^-^++ *^/^% _^# \\^% @^~',
  html: '<^>^</ /^\\ =^" "^\'^` {^} (^) !^- #^. :^; &^@ [^] _^* +^%',
  css: '{^} :^; .^# (^) -^_ %^! "^\' ,^> *^+ [^] @^& /^= ~^$',
  python: ':^= (^)^[]^{} "^\'^""" [^] {^} _^# .^, =^== *^/ +^- <^> !^? @^% \\^|',
  clike: ';^:^:: {^} (^)^[]^{}^<> [^] =^== "^\'^\\n <^> &^* .^, ->^:: !^? +^- /^% |^^ #^_',
  markdown: '#^* -^+ `^~^``` [^] (^) *^_ >^| !^? :^; "^\' \\^/ <^> =^&',
  json: '{^} [^] "^: ,^. -^+ true^false null^0 \\^/',
  plain: '(^)^[]^{} [^] {^} "^\'^` ;^: .^, -^_ =^+ /^\\ !^? @^# &^| *^%',
});

/**
 * Defaults of earlier versions. Saved settings contain the whole layouts, so
 * a layout still equal to an old default is replaced by the new default
 * (one the owner edited is kept).
 */
export const LEGACY_DEFAULT_LAYOUTS = Object.freeze([{
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
 * → 'none' (not decided yet / a small wobble), 'up' or 'down' (a swipe: a
 *   leaning or curved one counts, up to ~63° from vertical), or 'pan'
 *   (mostly sideways).
 */
export function classifyKeyDrag(dx, dyUp) {
  if (Math.hypot(dx, dyUp) < 8) return 'none';
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
  ['Operators', ['=', '==', '!=', '+', '-', '*', '/', '%', '&', '|', '&&', '||', '!', '?', ':', ';', ',', '.', '->', '::', '=>', '#', '@', '$', '\\', '^', '~', '_']],
]);

/** With Ctrl armed, the context row offers these (key letter, command). */
export const CTRL_KEYS = Object.freeze([
  ['S', 'save'], ['F', 'find'], ['D', 'selectNext'], ['A', 'selectAll'], ['/', 'toggleComment'], ['G', 'goToLine'],
  ['P', 'quickOpen'], ['X', 'cut'], ['C', 'copy'], ['V', 'paste'], ['Z', 'undo'], ['Y', 'redo'],
]);
