// ui/dragMove.js — context menus and drag-to-reorder / drag-to-move for lists
// (tabs, the file tree, open editors).
//
//   mouse   right-click opens the menu; press and move drags
//   touch   hold still until the menu opens, then keep moving: the menu
//           closes and the item follows the finger (like an Android home
//           screen). Lifting the finger without moving keeps the menu.
//
// While dragging, the item itself is lifted (a copy follows the finger, with
// a shadow) and its place in the list becomes an empty slot. The slot moves
// to where the item would land and the other items slide out of its way —
// like reordering in a phone's list. A target with no slot (into a folder,
// onto the code to split) just lights up.
//
// A quick swipe still scrolls the list: dragging needs the hold first.
// What can be dropped where is up to the caller (find / drop).

import { haptic, swallowNextClick } from './dom.js';
import { closeMenus } from './overlays.js';

const MOUSE_SLOP = 6;   // px before a mouse press becomes a drag
const TOUCH_SLOP = 10;  // px a finger may wander and still be holding still
const HOLD_MS = 480;
const EDGE = 36;        // px from the list's edge where it scrolls by itself
const SLIDE_MS = 160;   // the other items moving aside

const zoomOf = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;

/**
 * Moves `el` to `parent` before `before` (null = at the end), and animates
 * every other child of the old and the new parent from where it was to where
 * it is now (FLIP: First, Last, Invert, Play).
 */
function slideTo(el, parent, before) {
  if (before === el) return;
  if (el.parentNode === parent && el.nextElementSibling === before) return;
  const crowd = new Set();
  for (const p of [el.parentNode, parent]) if (p) for (const c of p.children) if (c !== el) crowd.add(c);
  const first = new Map([...crowd].map((c) => [c, c.getBoundingClientRect()])); // where they are seen now (mid-slide too)
  parent.insertBefore(el, before);
  for (const c of crowd) { c.style.transition = 'none'; c.style.transform = ''; }
  const z = zoomOf();
  for (const c of crowd) {
    const a = first.get(c);
    const b = c.getBoundingClientRect();
    const dx = (a.left - b.left) / z, dy = (a.top - b.top) / z;
    if (!dx && !dy) continue;
    c.style.transform = `translate(${dx}px, ${dy}px)`;
    const run = c._slide = (c._slide || 0) + 1; // a newer slide of the same item wins
    requestAnimationFrame(() => {
      if (c._slide !== run) return;
      c.style.transition = `transform ${SLIDE_MS}ms ease`;
      c.style.transform = '';
      setTimeout(() => { if (c._slide === run) c.style.transition = ''; }, SLIDE_MS + 20);
    });
  }
}

/**
 * @param {HTMLElement} list  the scrolling container
 * @param {string} selector   its items
 * @param {object} o
 *   menu(item, at)          long-press / right-click menu
 *   find(item, el, x, y)    drop target under the pointer, or null:
 *                           {slot: {parent, before, depth?}} → the item's slot goes there;
 *                           {el, cls} → `el` gets class `cls` while it is the target
 *   drop(item, target)
 *   axis                    'x' or 'y': the way the list scrolls
 *   lockAxis                the lifted item only moves along `axis`
 *   badge(item)             a number shown on the lifted item (several selected)
 *   ignore                  selector of parts that never start a drag (✕)
 *   getSettings             for haptics
 *   onDragChange(on, item)
 */
export function dragMove(list, selector, o) {
  let press = null;
  let eatClick = false;

  const mark = (p, t) => {
    if (p.target && p.target.el && p.target.cls) p.target.el.classList.remove(p.target.cls);
    p.target = t;
    if (t && t.el && t.cls) t.el.classList.add(t.cls);
    p.item.classList.toggle('slot-elsewhere', !!t && !t.slot); // lands in a folder / a split, not in the slot
    if (t && t.slot) {
      if (t.slot.depth != null) p.item.style.setProperty('--depth', t.slot.depth);
      slideTo(p.item, t.slot.parent, t.slot.before);
    }
  };

  const place = (p) => {
    const z = zoomOf();
    const dx = o.lockAxis && o.axis === 'y' ? 0 : p.x - p.x0;
    const dy = o.lockAxis && o.axis === 'x' ? 0 : p.y - p.y0;
    p.lift.style.transform = `translate(${dx / z}px, ${dy / z}px) scale(1.03)`;
    // Over the item's own slot: it stays where it is (asking again would
    // make the list jump back and forth under the finger).
    const r = p.item.getBoundingClientRect();
    if (p.target && p.target.slot && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return;
    const el = document.elementFromPoint(p.x, p.y);
    if (el && p.item.contains(el) && p.target) return;
    mark(p, o.find(p.item, el, p.x, p.y));
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

  /** The lifted copy: the item as it looks, following the finger. */
  const lift = (p) => {
    const r = p.item.getBoundingClientRect();
    const z = zoomOf();
    const copy = p.item.cloneNode(true);
    copy.removeAttribute('id');
    // A picture of the item, not a second one: nothing finds it by its path / id.
    for (const k of Object.keys(copy.dataset)) if (k !== 'git') delete copy.dataset[k];
    copy.setAttribute('aria-hidden', 'true');
    copy.classList.add('drag-lift');
    Object.assign(copy.style, { left: `${r.left / z}px`, top: `${r.top / z}px`, width: `${r.width / z}px`, height: `${r.height / z}px` });
    const n = o.badge ? o.badge(p.item) : 0;
    if (n > 1) { const b = document.createElement('span'); b.className = 'drag-count'; b.textContent = String(n); copy.append(b); }
    document.body.append(copy);
    return copy;
  };

  const startDrag = (p) => {
    closeMenus();
    p.state = 'drag';
    p.home = { parent: p.item.parentNode, before: p.item.nextElementSibling, depth: p.item.style.getPropertyValue('--depth') };
    p.lift = lift(p);
    p.item.classList.add('drag-origin');
    document.documentElement.classList.add('drag-moving');
    if (p.type !== 'mouse') haptic(o.getSettings && o.getSettings(), 12);
    o.onDragChange && o.onDragChange(true, p.item);
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
    document.removeEventListener('touchmove', onTouchMove, { capture: true });
    let target = dropIt ? p.target : null;
    // Let go where it started: nothing to do.
    if (target && target.slot && p.item.parentNode === p.home.parent && p.item.nextElementSibling === p.home.before
      && p.item.style.getPropertyValue('--depth') === p.home.depth) target = null;
    // The click that follows would open the item: not after the menu or a
    // move (after a drag that went nowhere it may: that was a sloppy click).
    if (p.state === 'held' || (p.state === 'drag' && target)) eatClick = true;
    // The menu opened under the finger: lifting it must not tap an item of it.
    if (p.state === 'held') swallowNextClick();
    if (p.state !== 'drag') return;
    if (p.target && p.target.el && p.target.cls) p.target.el.classList.remove(p.target.cls);
    // Nowhere to go: the item slides back home.
    if (!target || !target.slot) {
      if (p.home.depth) p.item.style.setProperty('--depth', p.home.depth);
      if (p.home.parent && p.home.parent.isConnected) slideTo(p.item, p.home.parent, p.home.before && p.home.before.isConnected ? p.home.before : null);
    }
    // The lifted copy settles into the slot (or back home), then the item shows again.
    const dest = p.item.getBoundingClientRect();
    const z = zoomOf();
    const copy = p.lift;
    const settle = () => {
      copy.remove();
      p.item.classList.remove('drag-origin', 'slot-elsewhere');
      document.documentElement.classList.remove('drag-moving');
      o.onDragChange && o.onDragChange(false, p.item);
    };
    if (target && !target.slot) {
      // into a folder / onto the code: the copy fades where it was let go
      copy.classList.add('drag-lift-drop');
      setTimeout(settle, 140);
    } else {
      const left = parseFloat(copy.style.left) * z, top = parseFloat(copy.style.top) * z;
      copy.style.transition = `transform ${SLIDE_MS}ms ease, box-shadow ${SLIDE_MS}ms ease`;
      copy.style.transform = `translate(${(dest.left - left) / z}px, ${(dest.top - top) / z}px)`;
      copy.classList.add('drag-lift-settle');
      setTimeout(settle, SLIDE_MS);
    }
    if (target) o.drop(p.item, target);
  };

  const hold = (p) => {
    clearTimeout(p.timer);
    p.state = 'held';
    o.menu(p.item, { x: p.x0, y: p.y0, gap: 18 }); // clear of the finger
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
  // Once the hold is recognised the page must not scroll under the finger
  // (on the document: the item may have moved into another list).
  function onTouchMove(e) { if (press && press.state !== 'down' && e.cancelable) e.preventDefault(); }
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
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  });
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
    o.menu(item, { x: e.clientX, y: e.clientY, gap: e.pointerType === 'touch' ? 18 : 0 });
  });
}
