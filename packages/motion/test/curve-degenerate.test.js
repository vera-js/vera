/**
 * `evaluate` never returns a non-finite number, whatever the keyframes are.
 *
 * A NaN here is written straight into a `Float64Array` and from there into
 * `translateY(NaNpx)`, which nothing downstream re-checks — the frame loop is
 * deliberately branch-light and takes what the curve gives it.
 *
 * The arithmetic that could produce one is a zero-length segment: `slopes[i]`
 * would be a division by zero, and in the eased path `slopes[i] * run` is then
 * `Infinity * 0`. `fillCurve` prevents it by treating a zero run as a flat
 * segment, and its docstring is careful to say that guard is **currently
 * unreachable**: `evaluate` scans downward and lands on the *later* of any two
 * keyframes sharing a position, whose run is non-zero.
 *
 * That unreachability was tested rather than taken on trust, and the reason
 * turns out to be stronger than the docstring's: **a zero-length segment
 * contains no positions, so nothing can select it.** It is not a property of
 * the scan direction. Removing the guard leaves this green; so does removing
 * the guard *and* reversing the scan; so does removing the guard and rewriting
 * the loop to select the first of a duplicate pair. All three were tried.
 *
 * So this file does not pin that guard, and nothing can. What it pins is the
 * **property** — and that has teeth against the failure modes which are
 * reachable, both confirmed by planting them:
 *
 * - an easing that returns `NaN` fails four of these outright
 * - `evaluate` losing its clamp and extrapolating past the last keyframe fails
 *   the bounds test
 *
 * Either would put `translateY(NaNpx)` or a runaway value into a
 * `Float64Array` that nothing downstream re-checks, because the frame loop is
 * deliberately branch-light and takes what the curve gives it.
 */
import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { buildCurve, evaluate } from '../src/modules/curve.ts';
import { resolveEasing } from '../src/easings.ts';

const EASE = resolveEasing('ease-in-out');

/** Every arrangement of a duplicate position, plus unsorted input. */
const CURVES = {
  'duplicate in the middle': [
    { position: 0, value: 0 }, { position: 50, value: 10 },
    { position: 50, value: 30 }, { position: 100, value: 40 },
  ],
  'duplicate at the start': [
    { position: 0, value: 0 }, { position: 0, value: 20 }, { position: 100, value: 40 },
  ],
  'duplicate at the end': [
    { position: 0, value: 0 }, { position: 100, value: 20 }, { position: 100, value: 40 },
  ],
  'every keyframe at the same position': [
    { position: 50, value: 5 }, { position: 50, value: 15 },
  ],
  'a single keyframe': [{ position: 50, value: 7 }],
  'given out of order': [
    { position: 100, value: 40 }, { position: 0, value: 0 }, { position: 50, value: 10 },
  ],
};

/** Well past both ends, because clamping is part of the property. */
const SAMPLES = [-1000, -50, -1, 0, 0.5, 25, 49.9, 50, 50.1, 75, 99.9, 100, 101, 1000];

describe('evaluate never returns a non-finite value', () => {
  for (const [label, points] of Object.entries(CURVES)) {
    for (const [how, ease] of [['linear', null], ['eased', EASE]]) {
      it(`${label}, ${how}`, () => {
        const curve = buildCurve(points, ease);
        const bad = SAMPLES
          .map((position) => [position, evaluate(curve, position)])
          .filter(([, value]) => !Number.isFinite(value));
        expect(bad).toEqual([]);
      });
    }
  }

  /** And stays inside the values it was given — no overshoot from a degenerate segment. */
  it('stays within the keyframe values it was built from', () => {
    for (const [, points] of Object.entries(CURVES)) {
      const values = points.map((p) => p.value);
      const curve = buildCurve(points, EASE);
      for (const position of SAMPLES) {
        const out = evaluate(curve, position);
        expect(out).toBeGreaterThanOrEqual(Math.min(...values));
        expect(out).toBeLessThanOrEqual(Math.max(...values));
      }
    }
  });
});
