import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { buildCurve, evaluate, curveStart, curveEnd, fillCurve } from '../src/modules/curve.ts';
import { resolveEasing } from '../src/easings.ts';

const pts = (...pairs) => pairs.map(([position, value]) => ({ position, value }));

describe('buildCurve', () => {
  it('sorts keyframes given out of order', () => {
    const c = buildCurve(pts([1, 100], [0, 0], [0.5, 50]));
    expect(Array.from(c.positions)).toEqual([0, 0.5, 1]);
    expect(Array.from(c.values)).toEqual([0, 50, 100]);
  });

  it('precomputes one slope per segment', () => {
    const c = buildCurve(pts([0, 0], [0.5, 50], [1, 100]));
    expect(c.slopes).toHaveLength(2);
    expect(c.slopes[0]).toBeCloseTo(100, 6);
    expect(c.slopes[1]).toBeCloseTo(100, 6);
  });

  it('treats two keyframes at the same position as a flat segment, not NaN', () => {
    const c = buildCurve(pts([0, 0], [0.5, 10], [0.5, 90], [1, 100]));
    expect(Array.from(c.slopes).every(Number.isFinite)).toBe(true);
  });

  it('handles a single keyframe', () => {
    const c = buildCurve(pts([0.5, 42]));
    expect(c.slopes).toHaveLength(0);
    expect(evaluate(c, 0)).toBe(42);
    expect(evaluate(c, 1)).toBe(42);
  });

  it('does not mutate the input array', () => {
    const input = pts([1, 100], [0, 0]);
    const copy = [...input];
    buildCurve(input);
    expect(input).toEqual(copy);
  });
});

describe('evaluate', () => {
  const two = buildCurve(pts([0, 0], [1, 100]));

  it('hits both endpoints exactly', () => {
    expect(evaluate(two, 0)).toBe(0);
    expect(evaluate(two, 1)).toBe(100);
  });

  it('interpolates linearly between them', () => {
    expect(evaluate(two, 0.25)).toBeCloseTo(25, 9);
    expect(evaluate(two, 0.5)).toBeCloseTo(50, 9);
    expect(evaluate(two, 0.75)).toBeCloseTo(75, 9);
  });

  it('clamps outside the authored range', () => {
    expect(evaluate(two, -5)).toBe(0);
    expect(evaluate(two, 5)).toBe(100);
  });

  it('honours an arbitrary number of keyframes', () => {
    /** The old model capped at two midpoints; this has four. */
    const many = buildCurve(pts([0, 0], [0.2, 80], [0.4, 20], [0.6, 90], [0.8, 10], [1, 100]));
    expect(evaluate(many, 0.2)).toBeCloseTo(80, 9);
    expect(evaluate(many, 0.4)).toBeCloseTo(20, 9);
    expect(evaluate(many, 0.6)).toBeCloseTo(90, 9);
    expect(evaluate(many, 0.8)).toBeCloseTo(10, 9);
    expect(evaluate(many, 0.3)).toBeCloseTo(50, 9);
  });

  it('is continuous across every segment boundary', () => {
    const c = buildCurve(pts([0, 0], [0.3, 50], [0.7, 60], [1, 100]));
    const eps = 1e-9;
    for (const boundary of [0.3, 0.7]) {
      expect(evaluate(c, boundary - eps)).toBeCloseTo(evaluate(c, boundary + eps), 6);
    }
  });

  it('handles descending and negative values', () => {
    const c = buildCurve(pts([0, 100], [1, -100]));
    expect(evaluate(c, 0.5)).toBeCloseTo(0, 9);
    expect(evaluate(c, 1)).toBe(-100);
  });

  it('supports keyframes outside 0..1, which extrapolate the range', () => {
    const c = buildCurve(pts([-0.5, 0], [1.5, 200]));
    expect(evaluate(c, -0.5)).toBe(0);
    expect(evaluate(c, 0.5)).toBeCloseTo(100, 9);
    expect(evaluate(c, 1.5)).toBe(200);
    expect(evaluate(c, -1)).toBe(0);
  });

  it('is exact, unlike the LUT it replaces', () => {
    /**
     * The LUT quantised to 1/resolution steps; measured max error was 0.77
     * units. A curve evaluates the real line.
     */
    const c = buildCurve(pts([0, 0], [0.3, 50], [1, 100]));
    expect(evaluate(c, 0.15)).toBeCloseTo(25, 12);
    expect(evaluate(c, 0.1234567)).toBeCloseTo((50 / 0.3) * 0.1234567, 12);
  });

  it('never allocates on the hot path', () => {
    /** A smoke check that repeated evaluation is stable and side-effect free. */
    const c = buildCurve(pts([0, 0], [0.5, 50], [1, 100]));
    const before = Array.from(c.values);
    for (let i = 0; i <= 1000; i++) evaluate(c, i / 1000);
    expect(Array.from(c.values)).toEqual(before);
  });
});


describe('curveStart / curveEnd', () => {
  it('report the authored range', () => {
    const c = buildCurve(pts([0.2, 0], [0.8, 100]));
    expect(curveStart(c)).toBeCloseTo(0.2, 9);
    expect(curveEnd(c)).toBeCloseTo(0.8, 9);
  });

  it('reflect keyframes outside 0..1', () => {
    const c = buildCurve(pts([-0.2, 0], [1.4, 100]));
    expect(curveStart(c)).toBeCloseTo(-0.2, 9);
    expect(curveEnd(c)).toBeCloseTo(1.4, 9);
  });
});


describe('eased curves', () => {
  /**
   * The easing shapes the relationship between *scroll position* and value —
   * the one thing CSS cannot express, since a transition runs on a timer and
   * cannot ask where the scrollbar is. Verified against real layout in
   * spikes/curve-ease.mjs.
   */
  const ease = resolveEasing('ease-in-out');

  it('leaves the ends exactly where a linear curve puts them', () => {
    const c = buildCurve([{ position: 0, value: 0 }, { position: 1, value: 500 }], ease);
    expect(evaluate(c, 0)).toBeCloseTo(0, 6);
    expect(evaluate(c, 1)).toBeCloseTo(500, 6);
  });

  it('bends the middle away from the straight line', () => {
    const points = [{ position: 0, value: 0 }, { position: 1, value: 500 }];
    const straight = buildCurve(points);
    const bent = buildCurve(points, ease);
    expect(evaluate(straight, 0.25)).toBeCloseTo(125, 6);
    expect(evaluate(bent, 0.25)).toBeLessThan(125);       // slow to leave
    expect(evaluate(bent, 0.75)).toBeGreaterThan(375);    // fast to arrive
    expect(evaluate(bent, 0.5)).toBeCloseTo(250, 1);      // symmetric at the midpoint
  });

  it('applies per segment, the way @keyframes does', () => {
    const c = buildCurve(
      [{ position: 0, value: 0 }, { position: 0.5, value: 250 }, { position: 1, value: 500 }],
      ease
    );
    /** The declared keyframe is honoured exactly... */
    expect(evaluate(c, 0.5)).toBeCloseTo(250, 6);
    /** ...and each half eases into and out of it, rather than easing once across both. */
    expect(evaluate(c, 0.25)).toBeCloseTo(125, 1);
    expect(evaluate(c, 0.125)).toBeLessThan(62.5);
    expect(evaluate(c, 0.375)).toBeGreaterThan(187.5);
  });

  it('clamps outside the authored range, easing or not', () => {
    const c = buildCurve([{ position: 0.2, value: 10 }, { position: 0.8, value: 90 }], ease);
    expect(evaluate(c, -5)).toBe(10);
    expect(evaluate(c, 5)).toBe(90);
  });

  it('carries a value past its target when the easing does', () => {
    const springy = resolveEasing('cubic-bezier(0.34, 1.56, 0.64, 1)');
    const c = buildCurve([{ position: 0, value: 0 }, { position: 1, value: 100 }], springy);
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, evaluate(c, t));
    expect(peak).toBeGreaterThan(100);
    expect(evaluate(c, 1)).toBeCloseTo(100, 6);
  });

  it('handles a descending segment', () => {
    const c = buildCurve([{ position: 0, value: 100 }, { position: 1, value: 0 }], ease);
    expect(evaluate(c, 0.25)).toBeGreaterThan(75);   // still near the start value
    expect(evaluate(c, 1)).toBeCloseTo(0, 6);
  });

  it('survives a zero-length segment without producing NaN', () => {
    const c = buildCurve(
      [{ position: 0.5, value: 0 }, { position: 0.5, value: 100 }, { position: 1, value: 200 }],
      ease
    );
    expect(Number.isNaN(evaluate(c, 0.5))).toBe(false);
    expect(Number.isNaN(evaluate(c, 0.75))).toBe(false);
  });

  it('is refilled in place without losing its easing', () => {
    const c = buildCurve([{ position: 0, value: 0 }, { position: 1, value: 500 }], ease);
    fillCurve(c, [{ position: 0, value: 0 }, { position: 1, value: 1000 }]);
    expect(evaluate(c, 1)).toBeCloseTo(1000, 6);
    expect(evaluate(c, 0.25)).toBeLessThan(250);
  });
});
