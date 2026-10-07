import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureRecognizer, gestureKey } from '../../src/core/gestures.js';

const VIEW = () => ({ width: 400, height: 800 });

/** Drives one finger from (x0,y0) to (x1,y1) over `ms` in `steps` moves. */
function oneFinger(r, x0, y0, x1, y1, ms, steps = 6) {
  r.pointerDown(1, x0, y0, 0);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    r.pointerMove(1, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, ms * f);
  }
  return r.pointerUp(1, x1, y1, ms);
}

function twoFingers(r, a0, b0, a1, b1, ms, steps = 6) {
  const events = [];
  r.pointerDown(1, a0[0], a0[1], 0);
  r.pointerDown(2, b0[0], b0[1], 5);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const t = 5 + (ms - 5) * f;
    const e1 = r.pointerMove(1, a0[0] + (a1[0] - a0[0]) * f, a0[1] + (a1[1] - a0[1]) * f, t);
    const e2 = r.pointerMove(2, b0[0] + (b1[0] - b0[0]) * f, b0[1] + (b1[1] - b0[1]) * f, t);
    if (e1) events.push(e1);
    if (e2) events.push(e2);
  }
  const up1 = r.pointerUp(1, a1[0], a1[1], ms);
  const up2 = r.pointerUp(2, b1[0], b1[1], ms + 10);
  return { events, up1, up2 };
}

test('fast horizontal flick to the right is a 1-finger right swipe', () => {
  const r = new GestureRecognizer({}, VIEW);
  const g = oneFinger(r, 100, 300, 260, 310, 150);
  assert.equal(g.type, 'swipe');
  assert.equal(g.direction, 'right');
  assert.equal(g.fingers, 1);
  assert.equal(gestureKey(g), 'swipe-right-1');
});

test('left swipe', () => {
  const r = new GestureRecognizer({}, VIEW);
  assert.equal(gestureKey(oneFinger(r, 300, 300, 150, 290, 120)), 'swipe-left-1');
});

test('slow drag is not a swipe (user is scrolling/reading)', () => {
  const r = new GestureRecognizer({}, VIEW);
  assert.equal(oneFinger(r, 100, 300, 260, 300, 900), null);
});

test('short flick below the distance threshold is ignored', () => {
  const r = new GestureRecognizer({}, VIEW);
  assert.equal(oneFinger(r, 100, 300, 140, 300, 60), null);
});

test('diagonal movement is not a swipe', () => {
  const r = new GestureRecognizer({}, VIEW);
  assert.equal(oneFinger(r, 100, 300, 200, 390, 120), null);
});

test('vertical flick is classified as up/down', () => {
  const r = new GestureRecognizer({}, VIEW);
  assert.equal(gestureKey(oneFinger(r, 200, 500, 205, 300, 150)), 'swipe-up-1');
});

test('touches that start on the screen edge belong to the OS back gesture', () => {
  const r = new GestureRecognizer({ edgeGuard: 20 }, VIEW);
  assert.equal(oneFinger(r, 5, 300, 200, 300, 120), null);
  // ...and the recognizer recovers for the next touch
  assert.equal(gestureKey(oneFinger(r, 60, 300, 240, 300, 120)), 'swipe-right-1');
});

test('configurable minimum distance', () => {
  const r = new GestureRecognizer({ minSwipeDistance: 120 }, VIEW);
  assert.equal(oneFinger(r, 100, 300, 200, 300, 100), null);
  r.setOptions({ minSwipeDistance: 40 });
  assert.equal(gestureKey(oneFinger(r, 100, 300, 200, 300, 100)), 'swipe-right-1');
});

test('two fingers moving left together = 2-finger left swipe', () => {
  const r = new GestureRecognizer({}, VIEW);
  const { up1, up2, events } = twoFingers(r, [250, 300], [260, 400], [100, 305], [110, 405], 180);
  assert.equal(events.length, 0, 'no pinch events for a parallel move');
  assert.equal(gestureKey(up1), 'swipe-left-2');
  assert.equal(up2, null, 'second finger lifting does not emit again');
});

test('two-finger tap', () => {
  const r = new GestureRecognizer({}, VIEW);
  const { up1 } = twoFingers(r, [150, 300], [250, 300], [152, 301], [249, 302], 120);
  assert.equal(gestureKey(up1), 'tap-2');
});

test('fingers spreading apart = pinch with growing scale', () => {
  const r = new GestureRecognizer({}, VIEW);
  const { events, up1 } = twoFingers(r, [180, 300], [220, 300], [100, 300], [300, 300], 300);
  assert.equal(events[0].type, 'pinch-start');
  assert.ok(events.at(-1).scale > 4.5, `scale ${events.at(-1).scale}`);
  assert.equal(up1.type, 'pinch-end');
});

test('fingers moving in opposite directions horizontally is not a swipe', () => {
  const r = new GestureRecognizer({ pinchThreshold: 10 }, VIEW); // disable pinch to test the swipe rule
  const { up1 } = twoFingers(r, [200, 300], [200, 400], [300, 300], [100, 400], 150);
  assert.equal(up1, null);
});

test('three fingers are ignored entirely', () => {
  const r = new GestureRecognizer({}, VIEW);
  r.pointerDown(1, 100, 300, 0);
  r.pointerDown(2, 150, 300, 1);
  r.pointerDown(3, 200, 300, 2);
  for (const id of [1, 2, 3]) r.pointerMove(id, 300, 300, 100);
  assert.equal(r.pointerUp(1, 300, 300, 120), null);
  assert.equal(r.pointerUp(2, 300, 300, 121), null);
  assert.equal(r.pointerUp(3, 300, 300, 122), null);
  assert.equal(r.active, false);
});

test('two-finger swipe is not mistaken for a pinch when fingers are reported one at a time', () => {
  const r = new GestureRecognizer({}, VIEW);
  r.pointerDown(1, 300, 300, 0);
  r.pointerDown(2, 300, 360, 0);
  const events = [];
  for (let i = 1; i <= 4; i++) {
    // finger 1 reported first, then finger 2 — in one event each
    const e1 = r.pointerMove(1, 300 - 40 * i, 300, i * 30);
    const e2 = r.pointerMove(2, 300 - 40 * i, 360, i * 30);
    if (e1) events.push(e1);
    if (e2) events.push(e2);
  }
  assert.equal(events.length, 0, 'a 40px lag of one finger is below pinchMinPx');
  assert.equal(gestureKey(r.pointerUp(1, 140, 300, 130)), 'swipe-left-2');
});

test('pointerMoves updates every finger before judging a pinch', () => {
  const r = new GestureRecognizer({ pinchMinPx: 0 }, VIEW);
  r.pointerDown(1, 300, 300, 0);
  r.pointerDown(2, 300, 360, 0);
  assert.equal(r.pointerMoves([{ id: 1, x: 200, y: 300 }, { id: 2, x: 200, y: 360 }], 50), null);
  assert.equal(gestureKey(r.pointerUp(1, 200, 300, 120)), 'swipe-left-2');
});
