// ui/dom.js — tiny DOM helpers + the icon set.
//
// `h('button.primary', {onclick}, 'Save')` builds elements the way
// React.createElement / Python's dominate do, without a framework. The UI
// shell is simple enough that a framework would mostly add bundle size.

const ICONS = {
  menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
  chevronDown: 'M7 10l5 5 5-5z',
  chevronRight: 'M10 7l5 5-5 5z',
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  forward: 'M4 13h12.2l-5.6 5.6L12 20l8-8-8-8-1.4 1.4 5.6 5.6H4z',
  undo: 'M12.5 8c-2.6 0-5 1-6.9 2.6L2 7v9h9l-3.6-3.6A8 8 0 0 1 20.1 16l2.4-.8A10.5 10.5 0 0 0 12.5 8z',
  redo: 'M18.4 10.6A10.5 10.5 0 0 0 1.5 15.2l2.4.8a8 8 0 0 1 12.7-3.6L13 16h9V7z',
  save: 'M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10z',
  split: 'M4 4h7v16H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm9 0h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7z',
  command: 'M4 5h16v2H4zm0 6h10v2H4zm0 6h16v2H4zm13-7l4 2-4 2z',
  play: 'M8 5v14l11-7z',
  stop: 'M6 6h12v12H6z',
  files: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm4 18H6V4h7v5h5z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z',
  outline: 'M3 5h2v2H3zm4 0h14v2H7zm-2 6h2v2H5zm4 0h12v2H9zm-2 6h2v2H7zm4 0h10v2H11z',
  git: 'M21.6 11.1 12.9 2.4a1.3 1.3 0 0 0-1.8 0L9.3 4.2l2.3 2.3a1.5 1.5 0 0 1 1.9 1.9l2.2 2.2a1.5 1.5 0 1 1-.9.9l-2.1-2.1v5.5a1.5 1.5 0 1 1-1.2-.1V9.3a1.5 1.5 0 0 1-.8-2l-2.3-2.2-6 6a1.3 1.3 0 0 0 0 1.8l8.7 8.7c.5.5 1.3.5 1.8 0l8.7-8.7c.5-.5.5-1.3 0-1.8z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2 4.9l-1.4 1.4A9 9 0 1 0 13 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8z',
  settings: 'M19.1 12.9a7 7 0 0 0 0-1.8l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.3 7.3 0 0 0-1.6-.9l-.4-2.6a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.6a7.3 7.3 0 0 0-1.6.9l-2.4-1a.5.5 0 0 0-.6.2L2.7 8.9a.5.5 0 0 0 .1.6l2 1.6a7 7 0 0 0 0 1.8l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3c.1.2.4.3.6.2l2.4-1c.5.4 1 .7 1.6.9l.4 2.6c0 .2.3.4.5.4h3.8c.2 0 .5-.2.5-.4l.4-2.6a7.3 7.3 0 0 0 1.6-.9l2.4 1c.2.1.5 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
  folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z',
  folderOpen: 'M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 12H4V8h16z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z',
  newFile: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm2 14h-3v3h-2v-3H8v-2h3v-3h2v3h3zM13 9V3.5L18.5 9z',
  newFolder: 'M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3z',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  keyboardHide: 'M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-9 3h2v2h-2zm0 3h2v2h-2zM8 6h2v2H8zm0 3h2v2H8zm-1 2H5V9h2zm0-3H5V6h2zm9 7H8v-2h8zm0-4h-2V9h2zm0-3h-2V6h2zm3 3h-2V9h2zm0-3h-2V6h2zm-7 15 4-4H8z',
  lock: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9z',
  unlock: 'M18 8h-9V6a3 3 0 0 1 5.8-1l1.9-.6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2z',
  wrap: 'M4 19h6v-2H4zM20 5H4v2h16zm-3 6H4v2h13.3c1.1 0 2 .9 2 2s-.9 2-2 2H15v-2l-3 3 3 3v-2h2a4 4 0 0 0 0-8z',
  format: 'M3 21h18v-2H3zm0-4h12v-2H3zm0-4h18v-2H3zm0-4h12V7H3zm0-6v2h18V3z',
  eye: 'M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  terminal: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H4V8h16zM6 10l4 3-4 3zm6 5h6v1h-6z',
  refresh: 'M17.6 6.4A8 8 0 1 0 19.7 14h-2.1A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.2 1.8L13 11h7V4z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  edit: 'M3 17.2V21h3.8l11-11-3.8-3.8zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
  download: 'M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  clear: 'M15 16h4v2h-4zm0-8h7v2h-7zm0 4h6v2h-6zM3 18a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8H3zM14 5h-3l-1-1H6L5 5H2v2h12z',
  maximize: 'M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z',
  minimize: 'M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z',
  gesture: 'M4.6 6.9c.7-.7 1.4-1.3 1.7-1.2.5.2 0 1-.3 1.5-.3.4-3 4-3 6.6 0 1.4.5 2.5 1.5 3.2.8.6 2 .8 3 .5 1.3-.4 2.3-1.7 3.7-3.4 1.5-1.8 3.5-4.2 5-4.2 2 0 2 1.2 2.2 2.2-1.4.2-6 2.1-6 6.4 0 2 1.7 3 2.7 3 1 0 2.5-.8 2.8-3.8H21v-2.5h-2.2c-.2-1.6-1.1-4-3.9-4-2.2 0-4 1.8-4.8 2.7-.6.7-2 2.4-2.3 2.6-.3.3-.8.8-1.2.8-.5 0-.9-.9-.5-2.1.4-1.2 1.5-3.1 2-3.8.8-1.2 1.4-2 1.4-3.4C9.5 4.7 8.8 4 7.9 4c-1.5 0-2.8 1.9-3.3 2.5zM14.7 19c-.2 0-.4-.2-.4-.6 0-.5.6-1.8 2.2-2.2-.2 1.4-.8 2.8-1.8 2.8z',
  zip: 'M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-2 6h-2v2h2v2h-2v2h-2v-2h2v-2h-2v-2h2v-2h-2V8h2v2h2z',
  device: 'M17 1H7a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm0 18H7V5h10z',
  branch: 'M6 2a3 3 0 0 0-1 5.8v8.4A3 3 0 1 0 7 16.2V14c0-1 .9-2 2-2h4a4 4 0 0 0 4-4v-.2A3 3 0 1 0 15 7.8V8c0 1.1-.9 2-2 2H9c-.7 0-1.4.2-2 .5V7.8A3 3 0 0 0 6 2z',
  sync: 'M12 4V1L8 5l4 4V6a6 6 0 0 1 5.7 7.9l1.5 1.5A8 8 0 0 0 12 4zm0 14a6 6 0 0 1-5.7-7.9L4.8 8.6A8 8 0 0 0 12 20v3l4-4-4-4z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
};

export function icon(name, size = 18) {
  const d = ICONS[name];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`;
}

/** Fills every [data-icon] element in `root` with its SVG. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.dataset.iconDone) continue;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.dataset.iconDone = '1';
  }
}

/**
 * h('div.row#main', {onclick, title}, child, 'text', [more children])
 * Attributes starting with "on" become listeners; `class`/`dataset`/`style` work as expected.
 */
export function h(tag, attrs = {}, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'icon') el.insertAdjacentHTML('afterbegin', icon(v, attrs.iconSize || 18));
    else if (k === 'iconSize') continue;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

export function isTouchDevice() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Hover styles only while a mouse or pen is in use. On a touch screen the
 * browser fakes :hover on the last tapped element and keeps it there after
 * the finger lifts (most visibly after a long press). The class follows the
 * pointer actually used, so a tablet with a mouse attached still gets hover.
 */
export function trackHoverInput(root = document.documentElement) {
  let kind = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches ? 'mouse' : 'touch';
  root.classList.toggle('can-hover', kind !== 'touch');
  const seen = (e) => {
    const k = e.pointerType === 'touch' ? 'touch' : 'mouse';
    if (k === kind) return;
    kind = k;
    root.classList.toggle('can-hover', k !== 'touch');
  };
  document.addEventListener('pointerdown', seen, { capture: true, passive: true });
  document.addEventListener('pointermove', seen, { capture: true, passive: true });
}

export function haptic(settings, ms = 8) {
  if (!settings || !settings.haptics) return;
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not allowed */ }
}

export function formatTime(ts) {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
