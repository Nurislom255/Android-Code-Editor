// ui/dragMove.js — context menus and drag-to-move for lists (tabs, file tree).
//
//   mouse   right-click opens the menu; press and move drags
//   touch   hold still until the menu opens, then keep moving: the menu
//           closes and the item follows the finger (like an Android home
//           screen). Lifting the finger without moving keeps the menu.
//
// A quick swipe still scrolls the list: dragging needs the hold first.
// What can be dropped where is up to the caller (find / drop).

import { h, haptic } from './dom.js';
import { closeMenus } from './overlays.js';

const MOUSE_SLOP = 6;   // px before a mouse press becomes a drag
const TOUCH_SLOP = 10;  // px a finger may wander and still be holding still
const HOLD_MS = 480;
const EDGE = 36;        // px from the list's edge where it scrolls by itself

/**
 * @param {HTMLElement} list  the scrolling container
 * @param {string} selector   its items
 * @param {object} o
 *   menu(item, at)          long-press / right-click menu
 *   label(item)             text on the chip that follows the pointer
 *   find(item, el, x, y)    drop target under the pointer ({el, cls, …}) or null;
 *                           `el` gets the class `cls` while it is the target
 *   drop(item, target)
 *   axis                    'x' or 'y': the way the list scrolls
 *   ignore                  selector of parts that never start a drag (✕)
 *   getSettings             for haptics
 *   onDragChange(on)
 */
export function dragMove(list, selector, o) {
  let press = null;
  let eatClick = false;

  const mark = (p, t) => {
    if (p.target && p.target.el) p.target.el.classList.remove(p.target.cls);
    p.target = t;
    if (t && t.el) t.el.classList.add(t.cls);
  };

  const place = (p) => {
    const touch = p.type !== 'mouse';
    // Above the finger, so the finger does not hide it.
    p.chip.style.transform = `translate(${p.x + (touch ? -20 : 14)}px, ${p.y + (touch ? -52 : 14)}px)`;
    mark(p, o.find(p.item, document.elementFromPoint(p.x, p.y), p.x, p.y));
  };

  const scrollLoop = (p) => {
    if (press !== p) return;
    const r = list.getBoundingClientRect();
    const [pos, lo, hi, across, a0, a1] = o.axis === 'x' ? [p.x, r.left, r.right, p.y, r.top, r.bottom] : [p.y, r.top, r.bottom, p.x, r.left, r.right];
    const over = across >= a0 && across <= a1; // e.g. not while over the other pane's tab bar
    const d = !over ? 0 : pos < lo + EDGE ? -(lo + EDGE - pos) : pos > hi - EDGE ? pos - (hi - EDGE) : 0;
    if (d) {
      const step = Math.max(-14, Math.min(14, d / 3));
      if (o.axis === 'x') list.scrollLeft += step; else list.scrollTop += step;
      place(p);
    }
    p.raf = requestAnimationFrame(() => scrollLoop(p));
  };

  const startDrag = (p) => {
    closeMenus();
    p.state = 'drag';
    p.item.classList.add('dragging');
    document.documentElement.classList.add('drag-moving');
    p.chip = h('div.drag-chip', o.label(p.item));
    document.body.append(p.chip);
    if (p.type !== 'mouse') haptic(o.getSettings && o.getSettings(), 12);
    o.onDragChange && o.onDragChange(true);
    place(p);
    p.raf = requestAnimationFrame(() => scrollLoop(p));
  };

  const finish = (dropIt) => {
    const p = press;
    if (!p) return;
    press = null;
    clearTimeout(p.timer);
    cancelAnimationFrame(p.raf);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancel, true);
    const target = p.target;
    // The click that follows would open the item: not after the menu or a
    // move (after a drag that went nowhere it may: that was a sloppy click).
    if (p.state === 'held' || (p.state === 'drag' && dropIt && target)) eatClick = true;
    if (p.state !== 'drag') return;
    mark(p, null);
    p.chip.remove();
    p.item.classList.remove('dragging');
    document.documentElement.classList.remove('drag-moving');
    o.onDragChange && o.onDragChange(false);
    if (dropIt && target) o.drop(p.item, target);
  };

  const hold = (p) => {
    clearTimeout(p.timer);
    p.state = 'held';
    o.menu(p.item, { x: p.x0, y: p.y0 });
  };

  function onMove(e) {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    p.x = e.clientX; p.y = e.clientY;
    const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
    if (p.state === 'down') {
      if (p.type === 'mouse') { if (moved >= MOUSE_SLOP && p.canDrag) startDrag(p); }
      else if (moved >= TOUCH_SLOP) finish(false); // a swipe: the list scrolls
      return;
    }
    if (p.state === 'held') { if (moved >= TOUCH_SLOP && p.canDrag) startDrag(p); return; }
    place(p);
  }
  function onUp(e) { if (press && e.pointerId === press.id) finish(true); }
  function onCancel(e) { if (press && e.pointerId === press.id) finish(false); }

  list.addEventListener('pointerdown', (e) => {
    eatClick = false;
    if (press) finish(false); // a second finger, or a press whose end never came
    const item = e.target.closest(selector);
    if (!item || !list.contains(item)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = press = {
      item, id: e.pointerId, type: e.pointerType, state: 'down', target: null,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      canDrag: !(o.ignore && e.target.closest(o.ignore)),
    };
    if (p.type !== 'mouse') p.timer = setTimeout(() => { if (press === p && p.state === 'down') hold(p); }, HOLD_MS);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
  });
  // Once the hold is recognised the list must not scroll under the finger.
  list.addEventListener('touchmove', (e) => { if (press && press.state !== 'down' && e.cancelable) e.preventDefault(); }, { passive: false });
  // No click after a drag or a long-press menu (it would open the item).
  list.addEventListener('click', (e) => { if (eatClick) { e.stopPropagation(); e.preventDefault(); eatClick = false; } }, true);
  list.addEventListener('contextmenu', (e) => {
    const item = e.target.closest(selector);
    if (!item || !list.contains(item)) return;
    e.preventDefault();
    if (press && press.item === item && press.type !== 'mouse') {
      // Android's own long-press signal can arrive before our timer.
      if (press.state === 'down') hold(press);
      return;
    }
    o.menu(item, { x: e.clientX, y: e.clientY });
  });
}
