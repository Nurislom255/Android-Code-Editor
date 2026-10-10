// core/gestures.js — touch gesture recognizer (pure logic, no DOM).
//
// The DOM layer (editor/gestureLayer.js) feeds it raw pointer positions and
// timestamps; this class decides what the movement *was*: a one-finger swipe,
// a two-finger swipe, a two-finger tap, or a pinch. Keeping the maths here, away
// from the DOM, is what makes it unit-testable in plain Node (tests/unit/
// gestures.test.mjs) — the same reason the spec keeps `editor-core` free of
// `android.*` imports.
//
// WHY THRESHOLDS ON DISTANCE *AND* TIME *AND* VELOCITY *AND* ANGLE:
// A slow horizontal drag is a user scrolling or reading, not a command. Only a
// short, fast, mostly-straight flick counts as a swipe. Each check removes a
// different false positive:
//   distance  → tiny finger jitter during a tap
//   duration  → a slow drag that eventually covers the distance
//   velocity  → a pause-then-flick still has to be fast overall
//   angle     → diagonal scrolls (most real scrolling is a bit diagonal)
//   long press→ a finger that rests first is selecting text, not swiping
//
// WHY THE ANGLE COMES FROM THE WHOLE PATH: a thumb swipe is an arc. Judging
// only the start and end points rejects many honest swipes whose last few
// pixels curl up or down. A line fitted through every sample (the principal
// axis — the direction the points spread out along) follows what the finger
// mostly did, so the more lenient of the two angles is used.
//
// WHY A DIRECTION LOCK: the browser decides on the first few pixels whether a
// touch scrolls. The layer must decide just as early whether to claim the
// touch, so the recognizer reports a "lock" as soon as the finger has moved
// `lockDistance` px: horizontal if it moved more sideways than up/down.

export const GESTURE_DEFAULTS = Object.freeze({
  minSwipeDistance: 56,      // CSS px the finger(s) must travel
  maxSwipeDuration: 500,     // ms from finger down to finger up
  minSwipeVelocity: 0.22,    // px per ms (= 220 px/s)
  maxAngle: 35,              // degrees a swipe may deviate from its axis
  lockDistance: 8,           // px before the horizontal/vertical lock is decided (≈ Android touch slop)
  longPressMs: 400,          // resting this long before moving = text selection, not a swipe
  tapMaxMovement: 12,        // px a finger may drift and still be a tap
  twoFingerTapMaxDuration: 300,
  pinchThreshold: 0.14,      // relative change in finger spread that starts a pinch…
  pinchMinPx: 28,            // …and at least this many px (fingers drift a bit in a 2-finger swipe)
  edgeGuard: 20,             // ignore touches starting this close to a screen edge
  tapMaxDuration: 300,       // a one-finger tap (for triple-tap)
  multiTapGap: 400,          // ms between the taps of a triple-tap
  multiTapSlop: 30,          // px every tap may be from the first one
});

/** Settings → Touch & gestures → Swipe sensitivity. */
export const SENSITIVITY_PRESETS = Object.freeze({
  strict: Object.freeze({ minSwipeDistance: 72, maxSwipeDuration: 400, minSwipeVelocity: 0.32, maxAngle: 25 }),
  normal: Object.freeze({ minSwipeDistance: 56, maxSwipeDuration: 500, minSwipeVelocity: 0.22, maxAngle: 35 }),
  loose: Object.freeze({ minSwipeDistance: 44, maxSwipeDuration: 650, minSwipeVelocity: 0.15, maxAngle: 40 }),
});

/** Recognizer options for a Settings sensitivity name. */
export function presetOptions(name) {
  return SENSITIVITY_PRESETS[name] || SENSITIVITY_PRESETS.normal;
}

const MAX_SAMPLES = 64;
const DEG = 180 / Math.PI;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Angle (0–90°) between the movement (dx, dy) and the horizontal or vertical axis. */
function offAxis(dx, dy, horizontal) {
  const a = Math.atan2(Math.abs(dy), Math.abs(dx)) * DEG; // 0 = horizontal
  return horizontal ? a : 90 - a;
}

/**
 * Orientation of the line that best fits the samples (total least squares),
 * as an off-axis angle like `offAxis`. Needs ≥ 3 samples.
 */
export function pathAngle(path, horizontal) {
  if (!path || path.length < 3) return null;
  let mx = 0, my = 0;
  for (const p of path) { mx += p.x; my += p.y; }
  mx /= path.length; my /= path.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of path) {
    const x = p.x - mx, y = p.y - my;
    sxx += x * x; syy += y * y; sxy += x * y;
  }
  if (sxx + syy === 0) return null;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // −90°…90°, 0 = horizontal
  return offAxis(Math.cos(theta), Math.sin(theta), horizontal);
}

export class GestureRecognizer {
  /**
   * @param {Partial<typeof GESTURE_DEFAULTS>} options
   * @param {() => {width:number,height:number}} getViewport  used for the edge guard
   */
  constructor(options = {}, getViewport = () => ({ width: Infinity, height: Infinity })) {
    this.opts = { ...GESTURE_DEFAULTS, ...options };
    this.getViewport = getViewport;
    /** Why the last finished touch was (not) a gesture — shown by the test pad. */
    this.lastDecision = null;
    this.taps = []; // recent one-finger taps, for triple-tap (kept across touches)
    this._reset();
  }

  setOptions(options) {
    this.opts = { ...this.opts, ...options };
  }

  _reset() {
    this.pointers = new Map(); // id -> {x0,y0,t0,x,y,t,path,movedAt}
    this.maxPointers = 0;
    this.ignored = false;      // started on a screen edge, or 3+ fingers
    this.consumed = false;     // a result was already emitted for this touch session
    this.pinching = false;
    this.spread0 = 0;
    this.lastScale = 1;
    this.lock = null;          // null | 'h' | 'v' — one-finger direction lock
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
    this.pointers.set(id, { x0: x, y0: y, t0: t, x, y, t, path: [{ x, y }], movedAt: null });
    this.maxPointers = Math.max(this.maxPointers, this.pointers.size);
    if (this.pointers.size > 2) this.ignored = true;

    if (this.pointers.size === 2) {
      // Re-baseline both fingers when the second one lands: the first finger
      // may already have wandered, and only movement *together* matters now.
      for (const p of this.pointers.values()) {
        p.x0 = p.x; p.y0 = p.y; p.t0 = t; p.path = [{ x: p.x, y: p.y }];
      }
      const [a, b] = [...this.pointers.values()];
      this.spread0 = Math.max(1, dist(a.x, a.y, b.x, b.y));
    }
    return null;
  }

  /** @returns lock / pinch events, else null */
  pointerMove(id, x, y, t) {
    return this.pointerMoves([{ id, x, y }], t);
  }

  /**
   * All fingers that moved in ONE touch event. The pinch check must run after
   * every finger is updated: judging after the first finger alone makes a
   * parallel two-finger swipe look like the fingers spreading apart.
   *
   * Returns `{type:'lock', axis:'h'|'v', dx, dy}` once per one-finger touch,
   * pinch events for two fingers, else null.
   */
  pointerMoves(moves, t) {
    let any = false;
    for (const { id, x, y } of moves) {
      const p = this.pointers.get(id);
      if (!p) continue;
      p.x = x; p.y = y; p.t = t;
      if (p.movedAt === null && dist(x, y, p.x0, p.y0) > this.opts.tapMaxMovement) p.movedAt = t;
      p.path.push({ x, y });
      if (p.path.length > MAX_SAMPLES) p.path = p.path.filter((_, i) => i % 2 === 0 || i === p.path.length - 1);
      any = true;
    }
    if (!any || this.ignored || this.consumed) return null;

    if (this.pointers.size === 1 && this.maxPointers === 1 && !this.lock) {
      const p = this.pointers.values().next().value;
      const dx = p.x - p.x0, dy = p.y - p.y0;
      if (Math.hypot(dx, dy) >= this.opts.lockDistance) {
        // A finger that rested first is long-press selecting: never lock it.
        if (t - p.t0 >= this.opts.longPressMs) { this.lock = 'none'; return null; }
        this.lock = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        return { type: 'lock', axis: this.lock, dx, dy, fingers: 1 };
      }
      return null;
    }
    if (this.pointers.size !== 2) return null;

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
    if (p.path.at(-1).x !== x || p.path.at(-1).y !== y) p.path.push({ x, y });

    let result = null;
    if (this.ignored) {
      if (!this.consumed) this.lastDecision = { gesture: null, reason: this.maxPointers > 2 ? '3+ fingers' : 'started at the screen edge' };
      this.consumed = true;
    } else if (!this.consumed) {
      if (this.pinching) {
        result = { type: 'pinch-end', fingers: 2, scale: this.lastScale };
        this.lastDecision = { gesture: result, reason: 'pinch' };
        this.consumed = true;
      } else if (this.maxPointers === 2 && this.pointers.size === 2) {
        // First of two fingers lifted: judge the two-finger gesture now,
        // using both fingers' latest positions.
        result = this._classify([...this.pointers.values()], t, 2);
        this.consumed = true;
      } else if (this.maxPointers === 1) {
        result = this._classify([p], t, 1);
        this.consumed = true;
        if (!result && this.lastDecision && this.lastDecision.reason === 'tap' && t - p.t0 <= this.opts.tapMaxDuration) {
          result = this._tap(p.x0, p.y0, t);
        } else if (result) this.taps = [];
      }
    }
    this.pointers.delete(id);
    if (this.pointers.size === 0) this.consumed = false;
    return result;
  }

  cancel() {
    this._reset();
  }

  /** Counts quick taps at one spot; the third one is a gesture. */
  _tap(x, y, t) {
    const o = this.opts;
    const last = this.taps[this.taps.length - 1];
    if (!last || t - last.t > o.multiTapGap || dist(x, y, this.taps[0].x, this.taps[0].y) > o.multiTapSlop) this.taps = [];
    this.taps.push({ x, y, t });
    if (this.taps.length < 3) return null;
    this.taps = [];
    const g = { type: 'tap', fingers: 1, count: 3, x, y };
    this.lastDecision = { gesture: g, reason: 'triple tap', fingers: 1 };
    return g;
  }

  _classify(points, tEnd, fingers) {
    const o = this.opts;
    const t0 = Math.max(...points.map((q) => q.t0));
    const duration = Math.max(1, tEnd - t0);
    const dxs = points.map((q) => q.x - q.x0);
    const dys = points.map((q) => q.y - q.y0);
    const dx = dxs.reduce((s, v) => s + v, 0) / points.length;
    const dy = dys.reduce((s, v) => s + v, 0) / points.length;
    const reject = (reason, extra = {}) => {
      this.lastDecision = { gesture: null, reason, fingers, duration, ...extra };
      return null;
    };

    const maxMove = Math.max(...points.map((q) => dist(q.x, q.y, q.x0, q.y0)));
    if (fingers === 2 && maxMove <= o.tapMaxMovement && duration <= o.twoFingerTapMaxDuration) {
      const g = { type: 'tap', fingers: 2, duration };
      this.lastDecision = { gesture: g, reason: 'two-finger tap', fingers, duration };
      return g;
    }

    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const main = horizontal ? dx : dy;
    const distance = Math.abs(main);
    const velocity = distance / duration;
    const endAngle = offAxis(dx, dy, horizontal);
    const fitAngle = fingers === 1 ? pathAngle(points[0].path, horizontal) : null;
    const angle = fitAngle === null ? endAngle : Math.min(endAngle, fitAngle);
    const metrics = { distance: Math.round(distance), angle: Math.round(angle), velocity: +velocity.toFixed(2), direction: horizontal ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up') };

    if (fingers === 1 && points[0].movedAt !== null && points[0].movedAt - points[0].t0 >= o.longPressMs) {
      return reject('long press (text selection)', metrics);
    }
    if (distance < o.minSwipeDistance) return reject(maxMove <= o.tapMaxMovement ? 'tap' : `too short (${metrics.distance} < ${o.minSwipeDistance} px)`, metrics);
    if (duration > o.maxSwipeDuration) return reject(`too slow (${Math.round(duration)} > ${o.maxSwipeDuration} ms)`, metrics);
    if (velocity < o.minSwipeVelocity) return reject(`too slow (${metrics.velocity} < ${o.minSwipeVelocity} px/ms)`, metrics);
    if (angle > o.maxAngle) return reject(`too diagonal (${metrics.angle}° > ${o.maxAngle}°)`, metrics);

    if (fingers === 2) {
      // Both fingers must travel the same way — otherwise it's a rotate or a
      // sloppy pinch, not a swipe.
      const parts = horizontal ? dxs : dys;
      const sign = Math.sign(main);
      if (!parts.every((v) => Math.sign(v) === sign && Math.abs(v) >= o.minSwipeDistance / 2)) return reject('fingers moved apart', metrics);
    }

    const g = {
      type: 'swipe', fingers, direction: metrics.direction, distance, duration, velocity, angle,
      startX: points[0].x0, startY: points[0].y0,
    };
    this.lastDecision = { gesture: g, reason: 'swipe', fingers, duration, ...metrics };
    return g;
  }
}

/** One line for the Settings test pad: what the last touch was, and why. */
export function describeDecision(d) {
  if (!d) return '';
  const m = d.distance !== undefined ? ` · ${d.distance} px · ${d.angle}° · ${Math.round(d.duration)} ms` : '';
  if (d.gesture) {
    const g = d.gesture;
    if (g.type === 'swipe') return `✓ Swipe ${g.direction}, ${g.fingers} finger${g.fingers > 1 ? 's' : ''}${m}`;
    if (g.type === 'tap') return g.count === 3 ? '✓ Triple tap' : `✓ Tap, ${g.fingers} fingers`;
    return `✓ ${g.type}`;
  }
  return `✗ Not a gesture: ${d.reason}${m}`;
}

/** Stable name used by the settings mapping, e.g. "swipe-right-1", "tap-2". */
export function gestureKey(g) {
  if (!g) return null;
  if (g.type === 'swipe') return `swipe-${g.direction}-${g.fingers}`;
  if (g.type === 'tap') return g.count === 3 ? 'tap-3x' : `tap-${g.fingers}`;
  return g.type;
}
