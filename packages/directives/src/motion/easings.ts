/**
 * The CSS timing-function solver: keywords, `cubic-bezier()` and `steps()`, resolved to a
 * function of progress.
 *
 * One vocabulary for the whole package. Until 2026-09-01 this file held a Penner tween table —
 * `easeInOutCubic(t, b, c, d)` and twenty-three siblings — that only `scroll-to` spoke, so one
 * options surface carried two unrelated easing languages and two types both named `Easing`.
 * Every Penner curve here is expressible as a `cubic-bezier()` (control points may leave 0-1 on
 * y, which is how `back`'s overshoot is written); the mapping for the old names is in the README.
 *
 * Shared source, inlined per artifact: `@verajs/motion/easings` wires it for the animation
 * runtime's `ease`, and `scroll-to` bundles its own copy for the tween — the deliberate
 * one-source-two-artifacts trade every shared helper here makes.
 */
import type { Easing } from './timing.js';

/**
 * The keyword forms, as their bezier control points. Straight from the CSS spec.
 *
 * A `Map` rather than an object literal, which inherits `constructor`,
 * `toString`, `valueOf`, `hasOwnProperty` and `__proto__`. Each of those looked
 * up truthy and was then spread into `bezier`, throwing a TypeError out of a
 * function whose whole contract is to return null for anything it does not
 * recognise. Core never reaches it — `parseEasing` matches an array first — but
 * this is exported from a package entry point, which is the same reason the
 * bezier arity check below exists.
 */
const KEYWORDS = new Map<string, readonly [number, number, number, number]>([
  ['ease', [0.25, 0.1, 0.25, 1]],
  ['ease-in', [0.42, 0, 1, 1]],
  ['ease-out', [0, 0, 0.58, 1]],
  ['ease-in-out', [0.42, 0, 0.58, 1]],
]);

/**
 * Solves a cubic bezier for y given x, the way CSS does.
 *
 * Newton-Raphson first, which reaches the answer in a step or two for the
 * curves anyone writes, and **bisection when it does not**. This used to be
 * Newton alone, on the reasoning that the only failure was a zero derivative
 * and returning the current estimate there was correct enough. That was wrong,
 * and not marginally: `x'(t)` approaching zero does not stall Newton, it throws
 * it out of the interval, and the next iteration compounds it.
 *
 * `cubic-bezier(1, 0, 0, 1)` — a legal, ordinary S-curve — returned **8,900**
 * where the answer is 0.5, and `cubic-bezier(1, 0, 1, 0)` reached 2.7e5.
 * Against a real engine, measured in `spikes/easing-oracle.mjs`, three of the
 * five hard curves disagreed with Chromium by up to 0.62. An author who wrote
 * one of them got an element several hundred pixels from where they put it,
 * and nothing refused the value because there is nothing wrong with it.
 *
 * The early return on convergence is what pays for the fallback: the fixed
 * five iterations became one or two for every curve anyone writes, so the
 * common path is *cheaper* than what it replaced. Measured, ns per call:
 * `ease-in-out` 44.4 -> 22.6, `ease-out` 44.3 -> 31.3, `ease-in` 47.4 -> 41.3,
 * `ease` unchanged at ~14. Only the curves that used to be wrong pay for the
 * bisection — 44 -> 85 and 119 — which is the right way round.
 */
const bezier = (x1: number, y1: number, x2: number, y2: number): Easing => {
  const a = (u: number, v: number) => 1 - 3 * v + 3 * u;
  const b = (u: number, v: number) => 3 * v - 6 * u;
  const c = (u: number) => 3 * u;
  const curve = (t: number, u: number, v: number) => ((a(u, v) * t + b(u, v)) * t + c(u)) * t;
  const slope = (t: number, u: number, v: number) => 3 * a(u, v) * t * t + 2 * b(u, v) * t + c(u);

  return (progress) => {
    let t = progress;
    for (let i = 0; i < 8; i++) {
      const offBy = curve(t, x1, x2) - progress;
      if (offBy > -1e-6 && offBy < 1e-6) return curve(t, y1, y2);
      const d = slope(t, x1, x2);
      if (d === 0) break;
      t -= offBy / d;
    }

    /**
     * `x(t)` is monotonic across `[0, 1]` for any control points CSS allows —
     * x1 and x2 are constrained to that range — so halving cannot miss the
     * root. Twenty steps take the interval below 1e-6, which is finer than a
     * pixel at any scroll length.
     */
    let low = 0;
    let high = 1;
    for (let i = 0; i < 20; i++) {
      t = (low + high) / 2;
      if (curve(t, x1, x2) < progress) low = t;
      else high = t;
    }
    return curve(t, y1, y2);
  };
};

/** `steps(n, position)` — a staircase, as CSS defines each jump term. */
const steps = (count: number, position: string): Easing => {
  const jumpStart = position === 'start' || position === 'jump-start' || position === 'jump-both';
  const jumpEnd = position === 'end' || position === 'jump-end' || position === 'jump-both';
  /** jump-none has count-1 jumps across count steps; jump-both has count+1. */
  const divisor = position === 'jump-none' ? count - 1 : jumpStart && jumpEnd ? count + 1 : count;
  const offset = jumpStart ? 1 : 0;

  return (progress) => {
    const step = Math.floor(progress * count) + offset;
    return divisor <= 0 ? 0 : Math.min(1, Math.max(0, step / divisor));
  };
};

/**
 * The same position allowlist core's `parseEasing` enforces. This is exported
 * from a package entry point, so it guards its own input — the reason the
 * bezier arity check below exists. Loose here (`[a-z-]+`) meant
 * `steps(3, bogus)` quietly behaved as `end` instead of answering null.
 */
const STEPS_FORM = /^steps\(\s*([1-9]\d*)\s*(?:,\s*(jump-(?:start|end|none|both)|start|end)\s*)?\)$/;
const BEZIER_FORM = /^cubic-bezier\(([^)]*)\)$/;

/**
 * The **continuous** timing functions — keywords and `cubic-bezier()` — which is all a scroll
 * tween can honestly take: a stepped smooth-scroll teleports in chunks, so `scroll-to` imports
 * this and tree-shaking leaves `steps()` out of its bundle (**187 B gzipped**, measured — nearly
 * the whole cost of retiring the Penner table). Holding at a value is meaningful for the
 * animation `ease`, where `paint` depends on it; `resolveEasing` below adds it there.
 *
 * @returns the easing, or **null for `linear` and for anything unrecognised** — a caller that
 * needs to tell those apart tests `'linear'` first, as both callers here do
 */
export const resolveCurve = (value: string): Easing | null => {
  if (value === 'linear') return null;

  const keyword = KEYWORDS.get(value);
  if (keyword) return bezier(...keyword);

  const curved = BEZIER_FORM.exec(value);
  if (curved) {
    const points = curved[1]!.split(',').map(Number);
    /**
     * The form above is deliberately loose because core has already validated
     * — but this is exported from a package entry point, so a caller can hand
     * it anything. Four finite numbers or nothing: without the check
     * `cubic-bezier(0,0,1)` built a curve returning NaN, which reaches the DOM
     * as a broken transform rather than as the null the caller already knows
     * how to handle.
     */
    if (points.length !== 4 || points.some((n) => !Number.isFinite(n))) return null;
    const [x1, y1, x2, y2] = points as [number, number, number, number];
    return bezier(x1, y1, x2, y2);
  }

  return null;
};

/**
 * Resolves a validated CSS timing function to a function of progress — the continuous curves
 * above, plus the step forms.
 *
 * @param value a string that has already passed `parseEasing`
 * @returns the easing, or **null for `linear`** — the caller uses that to keep
 * the straight-line path free of a call it does not need, which is what makes
 * curve easing cost nothing on a page that has not asked for it
 */
export const resolveEasing = (value: string): Easing | null => {
  const curve = resolveCurve(value);
  if (curve) return curve;

  if (value === 'step-start') return steps(1, 'start');
  if (value === 'step-end') return steps(1, 'end');

  const stepped = STEPS_FORM.exec(value);
  if (stepped) {
    if (stepped[2] === 'jump-none' && stepped[1] === '1') return null;
    return steps(Number(stepped[1]), stepped[2] ?? 'end');
  }

  return null;
};
