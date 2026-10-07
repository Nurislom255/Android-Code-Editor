// core/settings.js — settings defaults, validation and v1 → v2 migration.
// Pure: storage (localStorage) is done by the caller.

import { DEFAULT_LAYOUTS } from './keysLayout.js';

export const SETTINGS_VERSION = 2;

/** Actions a gesture can be mapped to (see editor/actions.js). */
export const GESTURE_ACTIONS = Object.freeze({
  none: 'Do nothing',
  autocomplete: 'Autocomplete (accept / next field / open list)',
  dismissOrDeleteWord: 'Close list / previous field / delete word',
  undo: 'Undo',
  redo: 'Redo',
  indent: 'Indent line',
  outdent: 'Outdent line',
  expandSelection: 'Expand selection',
  shrinkSelection: 'Shrink selection',
  commandPalette: 'Command palette',
  quickOpen: 'Quick open file',
  toggleComment: 'Toggle comment',
  hideKeyboard: 'Hide keyboard',
  nextTab: 'Next tab',
  prevTab: 'Previous tab',
  navigateBack: 'Go back',
  navigateForward: 'Go forward',
  save: 'Save file',
  run: 'Run / preview',
});

export const GESTURES = Object.freeze({
  'swipe-right-1': 'Swipe right (1 finger)',
  'swipe-left-1': 'Swipe left (1 finger)',
  'swipe-right-2': 'Swipe right (2 fingers)',
  'swipe-left-2': 'Swipe left (2 fingers)',
  'swipe-up-2': 'Swipe up (2 fingers)',
  'swipe-down-2': 'Swipe down (2 fingers)',
  'tap-2': 'Tap (2 fingers)',
});

export const DEFAULT_GESTURE_MAP = Object.freeze({
  'swipe-right-1': 'autocomplete',
  'swipe-left-1': 'dismissOrDeleteWord',
  'swipe-right-2': 'redo',
  'swipe-left-2': 'undo',
  'swipe-up-2': 'none',
  'swipe-down-2': 'hideKeyboard',
  'tap-2': 'commandPalette',
});

export const DEFAULTS = Object.freeze({
  version: SETTINGS_VERSION,
  theme: 'system',            // 'system' | 'dark' | 'light'
  fontSize: 14,
  tabWidth: 2,
  insertSpaces: true,
  wrapDefault: 'auto',        // 'auto' (on for narrow screens) | 'on' | 'off'
  lineNumbers: true,
  autoCloseBrackets: true,
  stickyScroll: true,
  fastScroll: true,
  autosave: 'off',            // 'off' | 'delay' | 'blur'
  autosaveDelay: 1500,
  keysBarMode: 'auto',        // 'auto' | 'always' | 'never'
  keysLayouts: { ...DEFAULT_LAYOUTS },
  haptics: true,
  gesturesEnabled: true,
  gestureHints: true,
  gestureMap: { ...DEFAULT_GESTURE_MAP },
  swipeDistance: 56,
  userSnippets: '',           // JSON: {"javascript": [{"label": "..", "body": ".."}]}
  runTimeLimit: 10,           // seconds; every run is also stoppable
  historyDays: 7,
  historyMaxPerFile: 40,
  ignoreList: '.git node_modules build',
  panelHeight: 240,
  sidebarWidth: 260,
  previewPlacement: 'auto',   // 'auto' (side on wide screens) | 'bottom' | 'side'
  previewAutoRefresh: true,
  formatOnSave: false,
  gitAuthorName: '',
  gitAuthorEmail: '',
  gitCorsProxy: 'https://cors.isomorphic-git.org',
});

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const oneOf = (v, options, d) => (options.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const str = (v, d, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : d);

/** Accepts anything (old versions, hand-edited JSON) and returns valid settings. */
export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULTS;
  const layouts = { ...d.keysLayouts };
  if (r.keysLayouts && typeof r.keysLayouts === 'object') {
    for (const k of Object.keys(layouts)) {
      if (typeof r.keysLayouts[k] === 'string' && r.keysLayouts[k].trim()) layouts[k] = r.keysLayouts[k].slice(0, 2000);
    }
  }
  const gestureMap = { ...d.gestureMap };
  if (r.gestureMap && typeof r.gestureMap === 'object') {
    for (const k of Object.keys(gestureMap)) {
      if (r.gestureMap[k] in GESTURE_ACTIONS) gestureMap[k] = r.gestureMap[k];
    }
  }
  return {
    version: SETTINGS_VERSION,
    // v1 only had 'dark' | 'light'; both are still valid.
    theme: oneOf(r.theme, ['system', 'dark', 'light'], d.theme),
    fontSize: clamp(r.fontSize, 8, 40, d.fontSize),
    tabWidth: clamp(r.tabWidth, 1, 8, d.tabWidth),
    insertSpaces: bool(r.insertSpaces, d.insertSpaces),
    wrapDefault: oneOf(r.wrapDefault, ['auto', 'on', 'off'], d.wrapDefault),
    lineNumbers: bool(r.lineNumbers, d.lineNumbers),
    autoCloseBrackets: bool(r.autoCloseBrackets, d.autoCloseBrackets),
    stickyScroll: bool(r.stickyScroll, d.stickyScroll),
    fastScroll: bool(r.fastScroll, d.fastScroll),
    autosave: oneOf(r.autosave, ['off', 'delay', 'blur'], d.autosave),
    autosaveDelay: clamp(r.autosaveDelay, 300, 60000, d.autosaveDelay),
    keysBarMode: oneOf(r.keysBarMode, ['auto', 'always', 'never'], d.keysBarMode),
    keysLayouts: layouts,
    haptics: bool(r.haptics, d.haptics),
    gesturesEnabled: bool(r.gesturesEnabled, d.gesturesEnabled),
    gestureHints: bool(r.gestureHints, d.gestureHints),
    gestureMap,
    swipeDistance: clamp(r.swipeDistance, 30, 160, d.swipeDistance),
    userSnippets: str(r.userSnippets, d.userSnippets, 50000),
    runTimeLimit: clamp(r.runTimeLimit, 1, 300, d.runTimeLimit),
    historyDays: clamp(r.historyDays, 1, 90, d.historyDays),
    historyMaxPerFile: clamp(r.historyMaxPerFile, 5, 500, d.historyMaxPerFile),
    ignoreList: str(r.ignoreList, d.ignoreList, 1000),
    panelHeight: clamp(r.panelHeight, 100, 2000, d.panelHeight),
    sidebarWidth: clamp(r.sidebarWidth, 160, 600, d.sidebarWidth),
    previewPlacement: oneOf(r.previewPlacement, ['auto', 'bottom', 'side'], d.previewPlacement),
    previewAutoRefresh: bool(r.previewAutoRefresh, d.previewAutoRefresh),
    formatOnSave: bool(r.formatOnSave, d.formatOnSave),
    gitAuthorName: str(r.gitAuthorName, d.gitAuthorName, 200),
    gitAuthorEmail: str(r.gitAuthorEmail, d.gitAuthorEmail, 200),
    gitCorsProxy: str(r.gitCorsProxy, d.gitCorsProxy, 500),
  };
}

export function ignoreNames(settings) {
  return settings.ignoreList.split(/[\s,]+/).filter(Boolean);
}
