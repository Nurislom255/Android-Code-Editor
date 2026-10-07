// core/gestures.js — touch gesture recognizer (pure logic, no DOM).
//
// The DOM layer (editor/gestureLayer.js) feeds it raw pointer positions and
// timestamps; this class decides what the movement *was*: a one-finger swipe,
// a two-finger swipe, a two-finger tap, or a pinch. Keeping the maths here, away
// from the DOM, is what makes it unit-testable in plain Node (tests/unit/
// gestures.test.mjs) — the same reason the spec keeps `editor-core` free of
// `android.*` imports.
//
// WHY THRESHOLDS ON DISTANCE *AND* TIME *AND* VELOCITY:
// A slow horizontal drag is a user scrolling or reading, not a command. Only a
// short, fast, mostly-straight flick counts as a swipe. Each check removes a
// different false positive:
//   distance  → tiny finger jitter during a tap
//   duration  → a slow drag that eventually covers the distance
//   velocity  → a pause-then-flick still has to be fast overall
//   axisRatio → diagonal scrolls (most real scrolling is a bit diagonal)

export const GESTURE_DEFAULTS = Object.freeze({
  minSwipeDistance: 56,      // CSS px the finger(s) must travel
  maxSwipeDuration: 450,     // ms from finger down to finger up
  minSwipeVelocity: 0.25,    // px per ms (= 250 px/s)
  axisRatio: 1.8,            // main axis must be ≥ ratio × cross axis
  tapMaxMovement: 12,        // px a finger may drift and still be a tap
  twoFingerTapMaxDuration: 300,
  pinchThreshold: 0.14,      // relative change in finger spread that starts a pinch…
  pinchMinPx: 28,            // …and at least this many px (fingers drift a bit in a 2-finger swipe)
  edgeGuard: 20,             // ignore touches starting this close to a screen edge
});

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export class GestureRecognizer {
  /**
   * @param {Partial<typeof GESTURE_DEFAULTS>} options
   * @param {() => {width:number,height:number}} getViewport  used for the edge guard
   */
  constructor(options = {}, getViewport = () => ({ width: Infinity, height: Infinity })) {
    this.opts = { ...GESTURE_DEFAULTS, ...options };
    this.getViewport = getViewport;
    this._reset();
  }

  setOptions(options) {
    this.opts = { ...this.opts, ...options };
  }

  _reset() {
    this.pointers = new Map(); // id -> {x0,y0,t0,x,y,t}
    this.maxPointers = 0;
    this.ignored = false;      // started on a screen edge, or 3+ fingers
    this.consumed = false;     // a result was already emitted for this touch session
    this.pinching = false;
    this.spread0 = 0;
    this.lastScale = 1;
  }

  get active() {
    return this.pointers.size > 0;
  }

  get isPinching() {
    return this.pinching;
  }

  pointerDown(id, x, y, t) {
    if (this.pointers.size === 0) {
      this._reset();
      const { width, height } = this.getViewport();
      const g = this.opts.edgeGuard;
      // Android's own back gesture lives on the left/right edges; a swipe that
      // starts there belongs to the OS, not to us.
      if (x < g || y < g || x > width - g || y > height - g) this.ignored = true;
    }
    this.pointers.set(id, { x0: x, y0: y, t0: t, x, y, t });
    this.maxPointers = Math.max(this.maxPointers, this.pointers.size);
    if (this.pointers.size > 2) this.ignored = true;

    if (this.pointers.size === 2) {
      // Re-baseline both fingers when the second one lands: the first finger
      // may already have wandered, and only movement *together* matters now.
      for (const p of this.pointers.values()) {
        p.x0 = p.x; p.y0 = p.y; p.t0 = t;
      }
      const [a, b] = [...this.pointers.values()];
      this.spread0 = Math.max(1, dist(a.x, a.y, b.x, b.y));
    }
    return null;
  }

  /** @returns pinch events while two fingers move apart/together, else null */
  pointerMove(id, x, y, t) {
    return this.pointerMoves([{ id, x, y }], t);
  }

  /**
   * All fingers that moved in ONE touch event. The pinch check must run after
   * every finger is updated: judging after the first finger alone makes a
   * parallel two-finger swipe look like the fingers spreading apart.
   */
  pointerMoves(moves, t) {
    let any = false;
    for (const { id, x, y } of moves) {
      const p = this.pointers.get(id);
      if (!p) continue;
      p.x = x; p.y = y; p.t = t;
      any = true;
    }
    if (!any || this.ignored || this.consumed || this.pointers.size !== 2) return null;

    const [a, b] = [...this.pointers.values()];
    const spread = dist(a.x, a.y, b.x, b.y);
    const scale = spread / this.spread0;
    if (!this.pinching && Math.abs(scale - 1) > this.opts.pinchThreshold && Math.abs(spread - this.spread0) > this.opts.pinchMinPx) {
      this.pinching = true;
      this.lastScale = scale;
      return { type: 'pinch-start', fingers: 2, scale };
    }
    if (this.pinching) {
      this.lastScale = scale;
      return { type: 'pinch', fingers: 2, scale };
    }
    return null;
  }

  /** @returns the finished gesture (swipe / tap / pinch-end) or null */
  pointerUp(id, x, y, t) {
    const p = this.pointers.get(id);
    if (!p) return null;
    p.x = x; p.y = y; p.t = t;

    let result = null;
    if (!this.ignored && !this.consumed) {
      if (this.pinching) {
        result = { type: 'pinch-end', fingers: 2, scale: this.lastScale };
        this.consumed = true;
      } else if (this.maxPointers === 2 && this.pointers.size === 2) {
        // First of two fingers lifted: judge the two-finger gesture now,
        // using both fingers' latest positions.
        result = this._classify([...this.pointers.values()], t, 2);
        this.consumed = true;
      } else if (this.maxPointers === 1) {
        result = this._classify([p], t, 1);
        this.consumed = true;
      }
    }
    this.pointers.delete(id);
    if (this.pointers.size === 0) this.consumed = false;
    return result;
  }

  cancel() {
    this._reset();
  }

  _classify(points, tEnd, fingers) {
    const o = this.opts;
    const t0 = Math.max(...points.map((q) => q.t0));
    const duration = Math.max(1, tEnd - t0);
    const dxs = points.map((q) => q.x - q.x0);
    const dys = points.map((q) => q.y - q.y0);
    const dx = dxs.reduce((s, v) => s + v, 0) / points.length;
    const dy = dys.reduce((s, v) => s + v, 0) / points.length;

    const maxMove = Math.max(...points.map((q) => dist(q.x, q.y, q.x0, q.y0)));
    if (fingers === 2 && maxMove <= o.tapMaxMovement && duration <= o.twoFingerTapMaxDuration) {
      return { type: 'tap', fingers: 2, duration };
    }

    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const main = horizontal ? dx : dy;
    const cross = horizontal ? dy : dx;
    const distance = Math.abs(main);
    const velocity = distance / duration;
    if (distance < o.minSwipeDistance) return null;
    if (duration > o.maxSwipeDuration) return null;
    if (velocity < o.minSwipeVelocity) return null;
    if (distance < o.axisRatio * Math.abs(cross)) return null;

    if (fingers === 2) {
      // Both fingers must travel the same way — otherwise it's a rotate or a
      // sloppy pinch, not a swipe.
      const parts = horizontal ? dxs : dys;
      const sign = Math.sign(main);
      if (!parts.every((v) => Math.sign(v) === sign && Math.abs(v) >= o.minSwipeDistance / 2)) return null;
    }

    const direction = horizontal ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    return {
      type: 'swipe', fingers, direction, distance, duration, velocity,
      startX: points[0].x0, startY: points[0].y0,
    };
  }
}

/** Stable name used by the settings mapping, e.g. "swipe-right-1", "tap-2". */
export function gestureKey(g) {
  if (!g) return null;
  if (g.type === 'swipe') return `swipe-${g.direction}-${g.fingers}`;
  if (g.type === 'tap') return `tap-${g.fingers}`;
  return g.type;
}
