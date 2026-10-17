// ui/dom.js — tiny DOM helpers + the icon set.
//
// `h('button.primary', {onclick}, 'Save')` builds elements the way
// React.createElement / Python's dominate do, without a framework. The UI
// shell is simple enough that a framework would mostly add bundle size.

import { CODICONS } from './codicons.js';

// The app's own drawings (24×24), for what Codicons has no match for:
// multi-cursor and joystick keys, hiding the keyboard, gestures, formatting.
const ICONS = {
  command: 'M4 5h16v2H4zm0 6h10v2H4zm0 6h16v2H4zm13-7l4 2-4 2z',
  cursors: 'M3 4h5v1.5H6.25v13H8V20H3v-1.5h1.75v-13H3zm8 6h5v1.5h-1.75v7H16V20h-5v-1.5h1.75v-7H11zm8-7h1.5v2.5H23V7h-2.5v2.5H19V7h-2.5V5.5H19z',
  joystick: 'M12 2l3.5 4h-7zm0 20l-3.5-4h7zM2 12l4-3.5v7zm20 0l-4 3.5v-7z',
  keyboardHide: 'M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-9 3h2v2h-2zm0 3h2v2h-2zM8 6h2v2H8zm0 3h2v2H8zm-1 2H5V9h2zm0-3H5V6h2zm9 7H8v-2h8zm0-4h-2V9h2zm0-3h-2V6h2zm3 3h-2V9h2zm0-3h-2V6h2zm-7 15 4-4H8z',
  format: 'M3 21h18v-2H3zm0-4h12v-2H3zm0-4h18v-2H3zm0-4h12V7H3zm0-6v2h18V3z',
  gesture: 'M4.6 6.9c.7-.7 1.4-1.3 1.7-1.2.5.2 0 1-.3 1.5-.3.4-3 4-3 6.6 0 1.4.5 2.5 1.5 3.2.8.6 2 .8 3 .5 1.3-.4 2.3-1.7 3.7-3.4 1.5-1.8 3.5-4.2 5-4.2 2 0 2 1.2 2.2 2.2-1.4.2-6 2.1-6 6.4 0 2 1.7 3 2.7 3 1 0 2.5-.8 2.8-3.8H21v-2.5h-2.2c-.2-1.6-1.1-4-3.9-4-2.2 0-4 1.8-4.8 2.7-.6.7-2 2.4-2.3 2.6-.3.3-.8.8-1.2.8-.5 0-.9-.9-.5-2.1.4-1.2 1.5-3.1 2-3.8.8-1.2 1.4-2 1.4-3.4C9.5 4.7 8.8 4 7.9 4c-1.5 0-2.8 1.9-3.3 2.5zM14.7 19c-.2 0-.4-.2-.4-.6 0-.5.6-1.8 2.2-2.2-.2 1.4-.8 2.8-1.8 2.8z',
};

/** An icon as SVG markup: Codicons first (VS Code's own set), then ours. */
export function icon(name, size = 18) {
  const c = CODICONS[name];
  if (c) {
    const [box, body] = typeof c === 'string' ? ['0 0 16 16', c] : c;
    return `<svg viewBox="${box}" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;
  }
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

/**
 * Vibration strengths (ms), one meaning each everywhere:
 *   tap    a key or button did its thing
 *   armed  something now waits for your next tap (Ctrl armed, pin mode, a menu opened)
 *   hold   a long press was recognised (tooltip, symbol fan, drag start, project actions)
 */
export const BUZZ = Object.freeze({ tap: 6, armed: 12, hold: 20 });

export function haptic(settings, ms = 8) {
  if (!settings || !settings.haptics) return;
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not allowed */ }
}

/**
 * After a long-press opened a menu, the browser may still send a click when
 * the finger lifts — to whatever is under it now: an item of that menu.
 * This swallows that one click (anywhere, for a moment).
 */
export function swallowNextClick(ms = 350) {
  const swallow = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
  document.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', swallow, true), ms);
}

/**
 * Long press (touch / pen, `ms`) or right-click (mouse) on `el` → fn(event).
 * The press then does nothing else: the click that follows is swallowed, and
 * the element shows `.armed` while the menu it opens is being chosen from.
 */
export function onLongPress(el, fn, { ms = 480, slop = 10, getSettings = () => null } = {}) {
  let p = null;
  const cancel = () => { if (p) clearTimeout(p.timer); p = null; };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    cancel();
    const press = { x: e.clientX, y: e.clientY, fired: false };
    press.timer = setTimeout(() => {
      press.fired = true;
      haptic(getSettings(), BUZZ.hold);
      fn(e);
    }, ms);
    p = press;
  });
  el.addEventListener('pointermove', (e) => { if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > slop) cancel(); });
  const end = () => {
    if (p && p.fired) swallowNextClick();
    cancel();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (p && p.fired) return; // Android's own long-press signal, after ours
    if (p) { clearTimeout(p.timer); p.fired = true; haptic(getSettings(), BUZZ.hold); } // ...or before ours
    fn(e);
  });
}

export function formatTime(ts) {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
