// settings.js
//
// WHY localStorage HERE (this is a real shipped app, not a Claude.ai
// artifact preview — the "no browser storage" restriction that applies to
// in-chat artifacts doesn't apply to a project you're building to deploy):
// Settings are small, synchronous, and don't need querying — just
// "give me the whole blob" / "save the whole blob." That's exactly what
// localStorage is for. IndexedDB would be the right call for something
// bigger or queryable (e.g. caching many files' contents), which is why
// a future "remember last-opened folder handle" feature should likely use
// IndexedDB instead — handles aren't JSON-serializable, and localStorage
// only stores strings.

const KEY = 'codeeditor:settings';

const DEFAULTS = {
  theme: 'dark',
  fontSize: 14,
  tabWidth: 2,
  panelHeight: 220,     // console/preview panel height in px — see the drag handle in main.js
  keysBarMode: 'auto',  // 'auto' | 'always' | 'never' — see keysBar.js
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage full or disabled — non-fatal, settings just won't persist
  }
}
