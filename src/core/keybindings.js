// core/keybindings.js — keyboard shortcuts as data (ROADMAP 2.9): the
// defaults come from the command table, the owner's changes are stored in
// settings as { commandId: "Ctrl+Shift+K" } ("" = no shortcut).
//
// A shortcut is written one way everywhere ("canonical"): modifiers in the
// order Ctrl, Shift, Alt, Cmd, then the key — "Ctrl+Shift+K", "Alt+↑", "F5",
// "Ctrl+Shift+\". Letters are upper case; arrows are ↑ ↓ ← →; named keys are
// Esc, Del, Home, End, PgUp, PgDn, Insert, Enter, Tab, Space, Backspace.

const NAMED = {
  arrowup: '↑', up: '↑', '↑': '↑', arrowdown: '↓', down: '↓', '↓': '↓',
  arrowleft: '←', left: '←', '←': '←', arrowright: '→', right: '→', '→': '→',
  escape: 'Esc', esc: 'Esc', delete: 'Del', del: 'Del', home: 'Home', end: 'End',
  pageup: 'PgUp', pgup: 'PgUp', pagedown: 'PgDn', pgdn: 'PgDn', insert: 'Insert', ins: 'Insert',
  enter: 'Enter', return: 'Enter', tab: 'Tab', space: 'Space', spacebar: 'Space', ' ': 'Space', backspace: 'Backspace',
};
const PUNCT = new Set(['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`']);
// KeyboardEvent.code of punctuation: the key itself, whatever Shift turns it into
const CODE_PUNCT = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlBackslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', NumpadAdd: '=', NumpadSubtract: '-' };
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'Fn', 'Hyper', 'Super']);

/** @param {{ctrl?:boolean, shift?:boolean, alt?:boolean, meta?:boolean, key:string}} c */
export function formatCombo(c) {
  return [c.ctrl && 'Ctrl', c.shift && 'Shift', c.alt && 'Alt', c.meta && 'Cmd', c.key].filter(Boolean).join('+');
}

function normalizeKey(k) {
  if (!k) return null;
  const lower = k.toLowerCase();
  if (NAMED[lower]) return NAMED[lower];
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase();
  if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase();
  if (k === '+') return '='; // the same key: Ctrl++ is Ctrl+Shift+= on most keyboards
  if (PUNCT.has(k)) return k;
  return null;
}

/**
 * Reads a shortcut as people write it ("ctrl+shift+k", "Alt+Up", "Shift+Alt+↓",
 * "Ctrl++") → canonical, or null when it isn't one.
 */
export function parseCombo(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (!s) return null;
  let parts = s.split('+').map((p) => p.trim());
  let key;
  if (s.endsWith('++')) { parts = parts.slice(0, -2); key = '+'; } // "Ctrl++"
  else key = parts.pop();
  const c = { ctrl: false, shift: false, alt: false, meta: false, key: normalizeKey(key) };
  if (!c.key) return null;
  for (const p of parts) {
    const m = p.toLowerCase();
    if (m === 'ctrl' || m === 'control' || m === 'mod') c.ctrl = true;
    else if (m === 'shift') c.shift = true;
    else if (m === 'alt' || m === 'option' || m === 'opt') c.alt = true;
    else if (m === 'cmd' || m === 'meta' || m === 'win' || m === 'super' || m === '⌘') c.meta = true;
    else return null;
  }
  return formatCombo(c);
}

/**
 * The shortcut a keydown is, canonical — or null (a soft keyboard's composed
 * text, a lone modifier, a key with no name). On a Mac, ⌘ counts as Ctrl
 * (the defaults' "Ctrl" is ⌘ there).
 */
export function comboFromEvent(e, { mac = false } = {}) {
  if (!e || e.isComposing || e.keyCode === 229 || !e.key || e.key === 'Unidentified' || e.key === 'Dead' || MODIFIER_KEYS.has(e.key)) return null;
  let key = null;
  const code = e.code || '';
  if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^\d$/.test(e.key) && !CODE_PUNCT[code]) key = e.key;
  else if (/^(Digit|Numpad)\d$/.test(code)) key = code.slice(-1);
  else if (CODE_PUNCT[code]) key = CODE_PUNCT[code];
  else key = normalizeKey(e.key);
  if (!key) return null;
  const meta = e.metaKey && !(mac && !e.ctrlKey);
  return formatCombo({ ctrl: e.ctrlKey || (mac && e.metaKey && !e.ctrlKey), shift: e.shiftKey, alt: e.altKey, meta, key });
}

/**
 * Whether the owner may use `combo` as a shortcut: it needs Ctrl, Alt or Cmd
 * (plain keys and Shift+key are typing), except F1–F24.
 * → null when fine, else the reason.
 */
export function comboProblem(combo) {
  const c = parseCombo(combo);
  if (!c) return 'Not a shortcut. Write it like Ctrl+Shift+K or Alt+↑.';
  const parts = c.split('+');
  const key = parts[parts.length - 1];
  if (/^F\d+$/.test(key)) return null;
  if (!parts.some((p) => p === 'Ctrl' || p === 'Alt' || p === 'Cmd')) return 'Add Ctrl or Alt: plain keys (and Shift + a key) are for typing.';
  return null;
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The shortcut a command has now: the owner's, else the default ("" = none). */
export function effectiveKey(id, defaults, overrides = {}) {
  return own(overrides, id) ? overrides[id] || '' : defaults[id] || '';
}

/** Commands other than `id` that `combo` already runs. */
export function conflictsOf(combo, id, defaults, overrides = {}) {
  if (!combo) return [];
  const ids = new Set([...Object.keys(defaults), ...Object.keys(overrides)]);
  return [...ids].filter((other) => other !== id && effectiveKey(other, defaults, overrides) === combo);
}

/**
 * What a pressed shortcut does, given the owner's changes:
 *   { run: id }      the owner gave this shortcut to a command
 *   { swallow: true } it is the old default of a command the owner moved or
 *                     cleared, and no other command still uses it by default:
 *                     nothing happens (the editor must not run the old one)
 *   null             not the owner's business: the defaults handle it
 */
export function resolveCombo(combo, defaults, overrides = {}) {
  if (!combo) return null;
  for (const [id, k] of Object.entries(overrides)) if (k === combo) return { run: id };
  let moved = false;
  for (const [id, k] of Object.entries(defaults)) {
    if (k !== combo) continue;
    if (!own(overrides, id)) return null; // still someone's default
    moved = true;
  }
  return moved ? { swallow: true } : null;
}

/**
 * Cleans the stored changes: canonical shortcuts, "" kept (= removed). With
 * the `defaults` (the app knows them; settings don't): known commands only,
 * and nothing that equals its default.
 */
export function normalizeBindings(raw, defaults = null) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v !== 'string' || !/^[\w.-]{1,60}$/.test(id)) continue;
    if (defaults && !own(defaults, id)) continue;
    if (v === '') { if (!defaults || defaults[id]) out[id] = ''; continue; }
    const c = parseCombo(v);
    if (c && !comboProblem(c) && (!defaults || c !== defaults[id])) out[id] = c;
  }
  return out;
}
