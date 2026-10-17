// ui/tooltips.js — long-press an icon to see what it is.
//
// A mouse shows the button's title on hover; a finger never hovers, so on
// touch a long press (and a light buzz) shows the same text in a bubble. The
// press then does nothing else: lifting the finger does not "click".
//
// Places where a long press already means something keep it: the keys bar
// (symbol fans, repeat), tabs and tree rows (menu + drag), the editor (text
// selection) and the project name (project actions).

import { haptic, BUZZ } from './dom.js';

export const TIP_DELAY = 450; // ms
const SLOP = 10;             // px a finger may wander and still be "holding"
const TIP_SHOWN = 1500;      // ms after the finger lifts

const TARGET = 'button[title], [role="button"][title], a[title]';
const SKIP = '#keys-bar, .keys-sheet, .tab, .tree-row, .cm-editor, #btn-project, [data-no-tip]';

/** The text a tooltip shows for an element, or '' if it gets none. */
export function tipText(el) {
  if (!el || el.closest(SKIP)) return '';
  return (el.getAttribute('title') || '').trim();
}

export function installTooltips({ getSettings = () => null } = {}) {
  let press = null; // { el, x, y, timer, fired }
  let bubble = null;
  let hideTimer = 0;

  const hide = () => {
    clearTimeout(hideTimer);
    if (bubble) { bubble.remove(); bubble = null; }
  };

  const show = (el, text) => {
    hide();
    bubble = document.createElement('div');
    bubble.className = 'tip';
    bubble.setAttribute('role', 'tooltip');
    bubble.textContent = text;
    document.body.append(bubble);
    const r = el.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
    // Above the finger's target when there is room, else below it; never off screen.
    const below = r.top - b.height - 8 < 8;
    const top = below ? r.bottom + 8 : r.top - b.height - 8;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), window.innerWidth - b.width - 8);
    bubble.style.top = `${top / zoom}px`;
    bubble.style.left = `${left / zoom}px`;
    bubble.classList.toggle('below', below);
  };

  document.addEventListener('pointerdown', (e) => {
    hide();
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    const el = e.target.closest && e.target.closest(TARGET);
    const text = tipText(el);
    if (!text) return;
    press = { el, x: e.clientX, y: e.clientY, fired: false };
    press.timer = setTimeout(() => {
      if (!press || press.el !== el) return;
      press.fired = true;
      haptic(getSettings(), BUZZ.hold);
      show(el, text);
    }, TIP_DELAY);
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (press && !press.fired && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) {
      clearTimeout(press.timer);
      press = null;
    }
  }, true);

  const end = () => {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.fired) {
      hideTimer = setTimeout(hide, TIP_SHOWN);
      // The click that follows the lift belongs to the tooltip, not the button.
      const el = press.el;
      const swallow = (ev) => { if (el.contains(ev.target)) { ev.preventDefault(); ev.stopPropagation(); } };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, true), 400);
    }
    press = null;
  };
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  // Android's own long-press menu for the button would cover the bubble.
  document.addEventListener('contextmenu', (e) => {
    if (press && press.el.contains(e.target)) e.preventDefault();
  }, true);
  window.addEventListener('scroll', hide, true);
}
