// core/settings.js — settings defaults, validation and v1 → v2 migration.
// Pure: storage (localStorage) is done by the caller.

import { DEFAULT_LAYOUTS, LEGACY_DEFAULT_LAYOUTS, normalizeBar } from './keysLayout.js';
import { normalizeBindings } from './keybindings.js';

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
  deleteLine: 'Delete the line',
  completeStatement: 'Complete statement (; and new line)',
  hideKeyboard: 'Hide keyboard',
  nextTab: 'Next tab',
  prevTab: 'Previous tab',
  navigateBack: 'Go back',
  navigateForward: 'Go forward',
  save: 'Save file',
  run: 'Run / preview',
  toggleZen: 'Zen mode on / off',
  toggleFullscreen: 'Fullscreen on / off',
});

export const GESTURES = Object.freeze({
  'swipe-right-1': 'Swipe right (1 finger)',
  'swipe-left-1': 'Swipe left (1 finger)',
  'swipe-right-2': 'Swipe right (2 fingers)',
  'swipe-left-2': 'Swipe left (2 fingers)',
  'swipe-up-2': 'Swipe up (2 fingers)',
  'swipe-down-2': 'Swipe down (2 fingers)',
  'tap-2': 'Tap (2 fingers)',
  'tap-3x': 'Triple-tap a line',
});

export const DEFAULT_GESTURE_MAP = Object.freeze({
  'swipe-right-1': 'autocomplete',
  'swipe-left-1': 'dismissOrDeleteWord',
  'swipe-right-2': 'redo',
  'swipe-left-2': 'undo',
  'swipe-up-2': 'none',
  'swipe-down-2': 'hideKeyboard',
  'tap-2': 'commandPalette',
  'tap-3x': 'deleteLine',
});

/** The themes (styles.css), after VS Code's. "system" follows the phone: Dark or Light Modern. */
export const THEMES = Object.freeze({ dark: 'Dark Modern', light: 'Light Modern', hc: 'High Contrast', monokai: 'Monokai' });

/**
 * The classes <html> gets for a theme setting. Dark themes also get
 * "theme-dark" (their base), so code asking "is it dark?" keeps working.
 */
export function themeClasses(setting, prefersLight = false) {
  const t = setting === 'system' || !THEMES[setting] ? (prefersLight ? 'light' : 'dark') : setting;
  return t === 'light' ? ['theme-light'] : t === 'dark' ? ['theme-dark'] : ['theme-dark', `theme-${t}`];
}

export const DEFAULTS = Object.freeze({
  version: SETTINGS_VERSION,
  theme: 'system',            // 'system' | a key of THEMES
  fontSize: 14,               // the code (pinch on the code changes it)
  uiZoom: 100,                // % — menus, tabs, panels, keys bar (not the code)
  autoHideTitle: true,        // phone: the title bar slides away while scrolling the code down
  tabWidth: 2,
  insertSpaces: true,
  wrapDefault: 'auto',        // 'auto' (on for narrow screens) | 'on' | 'off'
  lineNumbers: true,
  autoCloseBrackets: true,
  stickyScroll: true,
  fastScroll: true,
  previewTabs: true,          // a tap in the file tree opens a temporary (italic) tab
  autoReveal: true,           // the file tree follows the active tab
  compactFolders: true,       // a folder holding only one folder shows as a/b
  openEditorsOpen: false,     // the "Open editors" list above the file tree is unfolded
  wordHighlight: true,        // the other uses of the name under the cursor
  bracketPairColors: true,    // ( [ { coloured by nesting depth
  indentGuides: true,         // vertical lines at each indentation level
  autosave: 'off',            // 'off' | 'delay' | 'blur'
  autosaveDelay: 1500,
  keysBarMode: 'auto',        // 'auto' | 'always' | 'never'
  keysLayouts: { ...DEFAULT_LAYOUTS },
  keysBar: {},                // the owner's bar per profile (core/keysLayout.js DEFAULT_BAR); missing = default
  haptics: true,
  gesturesEnabled: true,
  gestureHints: true,
  gestureMap: { ...DEFAULT_GESTURE_MAP },
  gestureSensitivity: 'normal', // 'strict' | 'normal' | 'loose' (core/gestures.js presets)
  autoSemicolons: true,       // C-like languages and JS/TS (editor/semicolons.js)
  emmet: true,                // HTML/CSS abbreviations in autocomplete
  linkedTags: true,           // renaming <div> also renames </div>
  // Android: Chrome's EditContext input API. Off = the classic contenteditable
  // input, which reliably passes "no auto-capitals / no autocorrect" to the
  // keyboard (with EditContext, Gboard capitalised words in code).
  androidEditContext: false,
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
  keyBindings: {},            // the owner's shortcuts: { commandId: "Ctrl+Shift+K" | "" (none) }
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
      const v = r.keysLayouts[k];
      // An unedited old default gets the new default (it has more variants).
      if (typeof v === 'string' && v.trim() && !LEGACY_DEFAULT_LAYOUTS.some((old) => old[k] === v)) layouts[k] = v.slice(0, 2000);
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
    theme: oneOf(r.theme, ['system', ...Object.keys(THEMES)], d.theme),
    fontSize: clamp(r.fontSize, 8, 40, d.fontSize),
    uiZoom: clamp(r.uiZoom, 70, 160, d.uiZoom),
    autoHideTitle: bool(r.autoHideTitle, d.autoHideTitle),
    tabWidth: clamp(r.tabWidth, 1, 8, d.tabWidth),
    insertSpaces: bool(r.insertSpaces, d.insertSpaces),
    wrapDefault: oneOf(r.wrapDefault, ['auto', 'on', 'off'], d.wrapDefault),
    lineNumbers: bool(r.lineNumbers, d.lineNumbers),
    autoCloseBrackets: bool(r.autoCloseBrackets, d.autoCloseBrackets),
    stickyScroll: bool(r.stickyScroll, d.stickyScroll),
    fastScroll: bool(r.fastScroll, d.fastScroll),
    previewTabs: bool(r.previewTabs, d.previewTabs),
    autoReveal: bool(r.autoReveal, d.autoReveal),
    compactFolders: bool(r.compactFolders, d.compactFolders),
    openEditorsOpen: bool(r.openEditorsOpen, d.openEditorsOpen),
    wordHighlight: bool(r.wordHighlight, d.wordHighlight),
    bracketPairColors: bool(r.bracketPairColors, d.bracketPairColors),
    indentGuides: bool(r.indentGuides, d.indentGuides),
    autosave: oneOf(r.autosave, ['off', 'delay', 'blur'], d.autosave),
    autosaveDelay: clamp(r.autosaveDelay, 300, 60000, d.autosaveDelay),
    keysBarMode: oneOf(r.keysBarMode, ['auto', 'always', 'never'], d.keysBarMode),
    keysLayouts: layouts,
    keysBar: normalizeBar(r.keysBar),
    haptics: bool(r.haptics, d.haptics),
    gesturesEnabled: bool(r.gesturesEnabled, d.gesturesEnabled),
    gestureHints: bool(r.gestureHints, d.gestureHints),
    gestureMap,
    // v2.0 had a raw `swipeDistance` instead of presets: a raised value meant
    // "gestures trigger by accident", which is what Strict is for.
    gestureSensitivity: oneOf(r.gestureSensitivity, ['strict', 'normal', 'loose'], Number(r.swipeDistance) > 70 ? 'strict' : d.gestureSensitivity),
    autoSemicolons: bool(r.autoSemicolons, d.autoSemicolons),
    emmet: bool(r.emmet, d.emmet),
    linkedTags: bool(r.linkedTags, d.linkedTags),
    androidEditContext: bool(r.androidEditContext, d.androidEditContext),
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
    keyBindings: normalizeBindings(r.keyBindings),
  };
}

export function ignoreNames(settings) {
  return settings.ignoreList.split(/[\s,]+/).filter(Boolean);
}
