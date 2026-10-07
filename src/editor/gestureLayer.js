// editor/gestureLayer.js — touch gestures on the code (the DOM half; the maths
// is in core/gestures.js).
//
// Default gestures (all remappable in Settings → Gestures):
//   swipe right, 1 finger   autocomplete: accept the highlighted suggestion,
//                           else jump to the next snippet field, else open
//                           the suggestion list
//   swipe left, 1 finger    close the list / previous snippet field /
//                           delete the word before the cursor (like Gboard's
//                           swipe-left on backspace)
//   swipe left/right, 2     undo / redo
//   swipe down, 2 fingers   hide the keyboard
//   tap, 2 fingers          command palette
//   pinch                   zoom the code font (spec §2: pinch-to-zoom)
//   tap / drag line numbers select one / several lines (spec §3.2)
//
// WHY TOUCH EVENTS, NOT POINTER EVENTS: once the browser decides a touch is a
// scroll, it sends `pointercancel` and stops reporting that finger — we'd lose
// every swipe that starts like a scroll. Touch events keep coming during
// scrolling, so the recognizer always sees the whole movement.
//
// WHY "DID IT SCROLL?": with soft-wrap off, a horizontal flick is also how
// you scroll a long line. Rule: if the flick actually scrolled the code, it was
// a scroll; only a swipe that couldn't scroll anything becomes a command. With
// wrap on (the phone default) nothing scrolls sideways, so swipes always work.

import { GestureRecognizer, gestureKey } from '../core/gestures.js';

const IGNORE_SELECTOR = '.cm-tooltip, .cm-panels, .cm-fastscroll, .cm-sticky, .cm-gutters, .cm-search, input, textarea, button';

export function attachGestures(host, { getView, getSettings, runGesture, onPinch, onLineSelect }) {
  const recognizer = new GestureRecognizer({}, () => ({ width: window.innerWidth, height: window.innerHeight }));
  let session = null; // {scrollLeft, scrollTop, ignored}

  const settingsToOptions = () => {
    const s = getSettings();
    recognizer.setOptions({ minSwipeDistance: s.swipeDistance });
    return s;
  };

  host.addEventListener('touchstart', (e) => {
    const s = settingsToOptions();
    const view = getView();
    if (!view || !s.gesturesEnabled) return;
    if (!recognizer.active) {
      session = {
        scrollLeft: view.scrollDOM.scrollLeft,
        scrollTop: view.scrollDOM.scrollTop,
        ignored: !!(e.target.closest && e.target.closest(IGNORE_SELECTOR)),
      };
    }
    for (const t of e.changedTouches) recognizer.pointerDown(t.identifier, t.clientX, t.clientY, e.timeStamp);
  }, { capture: true, passive: true });

  host.addEventListener('touchmove', (e) => {
    if (!session) return;
    const s = getSettings();
    if (!s.gesturesEnabled) return;
    // Two fingers belong to us (pinch / two-finger swipes): stop the browser
    // from scrolling or zooming the page at the same time.
    if (e.touches.length >= 2 && e.cancelable) e.preventDefault();
    const ev = recognizer.pointerMoves([...e.changedTouches].map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY })), e.timeStamp);
    if (ev && !session.ignored) onPinch(ev);
  }, { capture: true, passive: false });

  const end = (e) => {
    if (!session) return;
    for (const t of e.changedTouches) {
      const g = recognizer.pointerUp(t.identifier, t.clientX, t.clientY, e.timeStamp);
      if (!g || session.ignored) continue;
      if (g.type === 'pinch-end') { onPinch(g); continue; }
      // A cancelled touch was taken over by the system (e.g. Android's own
      // navigation gesture) — never act on it.
      if (e.type === 'touchcancel') continue;
      handle(g);
    }
    if (!recognizer.active) session = null;
  };
  host.addEventListener('touchend', end, { capture: true, passive: true });
  host.addEventListener('touchcancel', end, { capture: true, passive: true });

  function handle(g) {
    const view = getView();
    if (!view) return;
    if (g.type === 'swipe' && g.fingers === 1) {
      // Vertical one-finger movement is always scrolling.
      if (g.direction === 'up' || g.direction === 'down') return;
      const scrolled = Math.abs(view.scrollDOM.scrollLeft - session.scrollLeft) > 6
        || Math.abs(view.scrollDOM.scrollTop - session.scrollTop) > 40;
      if (scrolled) return;
    }
    const key = gestureKey(g);
    if (key) runGesture(key, view, g);
  }

  // ---- line-number gutter: tap selects a line, drag selects several ----------
  host.addEventListener('pointerdown', (e) => {
    const gutter = e.target.closest && e.target.closest('.cm-lineNumbers');
    if (!gutter || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const view = getView();
    if (!view) return;
    e.preventDefault();
    const lineAtY = (y) => view.state.doc.lineAt(view.lineBlockAtHeight(y - view.documentTop).from);
    const anchorLine = lineAtY(e.clientY);
    const select = (y) => {
      const cur = lineAtY(y);
      const forward = cur.number >= anchorLine.number;
      const from = forward ? anchorLine.from : cur.from;
      const toLine = forward ? cur : anchorLine;
      const to = toLine.number < view.state.doc.lines ? toLine.to + 1 : toLine.to;
      view.dispatch({ selection: { anchor: forward ? from : to, head: forward ? to : from }, userEvent: 'select.pointer' });
    };
    select(e.clientY);
    gutter.setPointerCapture(e.pointerId);
    let autoScroll = 0;
    let lastY = e.clientY;
    const tick = () => {
      const r = view.scrollDOM.getBoundingClientRect();
      const edge = 36;
      let dy = 0;
      if (lastY < r.top + edge) dy = -Math.ceil((r.top + edge - lastY) / 3);
      else if (lastY > r.bottom - edge) dy = Math.ceil((lastY - (r.bottom - edge)) / 3);
      if (dy) { view.scrollDOM.scrollTop += dy; select(Math.min(Math.max(lastY, r.top + 1), r.bottom - 1)); }
      autoScroll = requestAnimationFrame(tick);
    };
    autoScroll = requestAnimationFrame(tick);
    const move = (ev) => { lastY = ev.clientY; select(ev.clientY); };
    const up = () => {
      cancelAnimationFrame(autoScroll);
      gutter.removeEventListener('pointermove', move);
      gutter.removeEventListener('pointerup', up);
      gutter.removeEventListener('pointercancel', up);
      onLineSelect && onLineSelect(view);
    };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', up);
    gutter.addEventListener('pointercancel', up);
  }, true);

  return recognizer;
}

/** Horizontal swipes on a strip (the status bar) → callback('left'|'right'). */
export function attachStripSwipe(el, getSettings, onSwipe) {
  const r = new GestureRecognizer({ minSwipeDistance: 40, edgeGuard: 0 }, () => ({ width: window.innerWidth, height: window.innerHeight }));
  el.addEventListener('touchstart', (e) => {
    if (!getSettings().gesturesEnabled) return;
    for (const t of e.changedTouches) r.pointerDown(t.identifier, t.clientX, t.clientY, e.timeStamp);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    r.pointerMoves([...e.changedTouches].map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY })), e.timeStamp);
  }, { passive: true });
  const end = (e) => {
    for (const t of e.changedTouches) {
      const g = r.pointerUp(t.identifier, t.clientX, t.clientY, e.timeStamp);
      if (g && g.type === 'swipe' && g.fingers === 1 && (g.direction === 'left' || g.direction === 'right')) onSwipe(g.direction);
    }
  };
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', end, { passive: true });
}
