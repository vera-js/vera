/**
 * A curve is a set of keyframes with its interpolation precomputed.
 *
 * This replaces the LUT. The LUT precomputed every value across the timeline
 * at 1/resolution steps so the scroll path became an array index — a sound
 * instinct that measured as a net loss: it cost ~5.7ms of init blocking and
 * ~1.65MB of memory to be *slower* than simply not allocating on the hot path.
 *
 * What made the old direct path slow was `getAnimationDefaults()` building a
 * fresh 8-property object on every call — once per animation, per element, per
 * frame. Here the defaults are resolved once at parse time and the segments are
 * precomputed as parallel typed arrays, so evaluation is a scan and two
 * multiplies with **no allocation at all**. Benchmarked at 2x the LUT's speed
 * with none of its memory or init cost.
 *
 * It also removes the old hard cap of two midpoints: a curve holds any number
 * of keyframes.
 */

import type { Easing } from './timing.js';

/**
 * Interpolated values. (A `kind: 'numeric'` discriminant shipped here for a second curve kind
 * that never arrived — a single-member union whose tag nothing read; removed 2026-09-01.)
 */
export interface NumericCurve {
  /**
   * Shapes each segment, or null for a straight line.
   *
   * Null rather than an identity function so the common case costs nothing:
   * the branch below skips a call rather than making one that returns its
   * argument. This is the relationship between *scroll position* and value,
   * which is the one thing CSS cannot express — see `timing.ts`.
   */
  readonly ease: Easing | null;
  /** Timeline positions, ascending. 0 is the start of the scroll window, 1 the end. */
  readonly positions: Float64Array;
  readonly values: Float64Array;
  /** slopes[i] carries positions[i] -> positions[i + 1]. Length is positions.length - 1. */
  readonly slopes: Float64Array;
  /**
   * Holds each keyframe's value across its segment instead of interpolating.
   *
   * For properties whose values are not numbers at all — a colour, a gradient,
   * a shadow. The module gives each authored value a slot in its own table and
   * the number on this curve is that slot, so anything *between* two slots is
   * a different value entirely, usually one belonging to another element.
   *
   * `ease` therefore cannot reach a held curve, and the `hold` branch in
   * `evaluate` returning before the easing is not an oversight: an easing
   * reshapes progress **within a segment**, and a held segment has one value
   * from end to end. The boundaries are the keyframe positions, which no
   * easing moves. Documented in `docs/modules/paint.md` rather than reported,
   * because an `ease` on such an element is not wrong — the same attribute
   * shapes any numeric property beside it.
   */
  readonly hold: boolean;
}


export interface CurvePoint {
  readonly position: number;
  readonly value: number;
}


/**
 * Doubles a curve of `n` keyframes occupies in a shared arena: positions and
 * values hold `n` each, slopes one per segment. The layout itself — positions,
 * then values, then slopes — lives in `buildCurve` and nowhere else; this is
 * only the width a caller needs to place curves side by side.
 */
export const curveDoubles = (n: number): number => Math.max(0, 3 * n - 1);

/**
 * Builds an interpolated curve from keyframes.
 *
 * @param points at least one keyframe; order does not matter, they are sorted here
 * @param ease shapes each segment; null is a straight line
 * @param hold step at each keyframe rather than interpolate between them
 * @param arena a shared buffer to carve the curve's arrays out of, as
 * *persistent* subarray views — created once here, never per read, so
 * everything downstream indexes them exactly as it would three owned arrays.
 * Omitted, the curve allocates its own — the form every direct caller and the
 * band-edge rebuild use. One element's curves sharing a buffer is a memory
 * shape, not a semantic one: the two forms are indistinguishable to a reader.
 * @param offset where in `arena` this curve starts; the caller advances by
 * `curveDoubles(points.length)`
 * @returns a curve ready for allocation-free evaluation
 */
export const buildCurve = (
  points: readonly CurvePoint[],
  ease: Easing | null = null,
  hold = false,
  arena?: Float64Array,
  offset = 0
): NumericCurve => {
  const n = points.length;
  /** Standalone, a curve owns a one-curve arena — the two forms are one code path. */
  const a = arena ?? new Float64Array(curveDoubles(n));
  const curve: NumericCurve = {
    ease,
    hold,
    positions: a.subarray(offset, offset + n),
    values: a.subarray(offset + n, offset + 2 * n),
    slopes: a.subarray(offset + 2 * n, offset + 2 * n + Math.max(0, n - 1)),
  };
  fillCurve(curve, points);
  return curve;
};

/**
 * Recomputes a curve's contents in place, for the same number of keyframes.
 *
 * Positions in viewport or absolute units resolve against geometry, so those
 * curves are rebuilt whenever the page resizes. The keyframe count cannot
 * change — only the parsed attribute decides that — so the existing typed
 * arrays are overwritten rather than reallocated, and every reference held by
 * a plan stays valid.
 *
 * @param curve a curve whose arrays are already sized for `points`
 * @param points keyframes; order does not matter, they are sorted here
 */
export const fillCurve = (curve: NumericCurve, points: readonly CurvePoint[]): void => {
  const sorted = [...points].sort((a, b) => a.position - b.position);
  const { positions, values, slopes } = curve;
  const n = sorted.length;

  for (let i = 0; i < n; i++) {
    positions[i] = sorted[i]!.position;
    values[i] = sorted[i]!.value;
  }

  for (let i = 0; i < n - 1; i++) {
    const run = positions[i + 1]! - positions[i]!;
    /**
     * Two keyframes at the same position would divide by zero. Treating it as
     * a flat segment makes it a hard step instead of NaN, which is the more
     * useful reading of "two values at the same instant".
     *
     * **Defensive, and currently unreachable** — checked rather than assumed.
     * `evaluate` scans downward and returns at the highest index whose
     * position it has passed, so with a duplicate it always lands on the
     * *later* one, whose run is non-zero. Every arrangement was tried:
     * duplicates at the start, the middle and the end. The guard stays because
     * it costs one conditional and the thing it prevents is a NaN written into
     * a Float64Array that nothing downstream re-checks — but nobody should
     * read this as describing something that happens today, and a test that
     * removes it will not go red.
     */
    slopes[i] = run === 0 ? 0 : (values[i + 1]! - values[i]!) / run;
  }
};


/**
 * Evaluates a numeric curve at a timeline position.
 *
 * Clamps to the first and last keyframe outside the authored range, so an
 * element holds its start value before the animation begins and its end value
 * after it finishes.
 *
 * An easing applies **per segment**, which is what CSS `@keyframes` does with
 * `animation-timing-function` — three keyframes with `ease-in-out` ease into
 * and out of the middle one, rather than easing once across the whole range.
 *
 * Deliberately allocation-free and branch-light: this runs once per animation,
 * per element, per frame (principle #4).
 */
export const evaluate = (curve: NumericCurve, position: number): number => {
  const { positions, values, slopes, ease, hold } = curve;
  const last = positions.length - 1;

  if (position <= positions[0]!) return values[0]!;
  if (position >= positions[last]!) return values[last]!;

  /**
   * Scanning from the end is the cheaper direction: scroll animations spend
   * most of their time past the first keyframe, and keyframe counts are small
   * enough (2-5 typical) that a binary search would cost more than it saves.
   */
  for (let i = last - 1; i >= 0; i--) {
    const start = positions[i]!;
    if (position < start) continue;
    if (hold) return values[i]!;
    if (ease === null) return values[i]! + (position - start) * slopes[i]!;

    /**
     * Eased: the same segment, but the fraction through it is reshaped first.
     * `slopes[i] * run` is the segment's total change, so no extra array is
     * needed to hold it — the straight-line path above is untouched, and
     * measures identically.
     */
    const run = positions[i + 1]! - start;
    const fraction = run === 0 ? 0 : (position - start) / run;
    return values[i]! + slopes[i]! * run * ease(fraction);
  }

  return values[0]!;
};


/** The timeline position of a curve's first keyframe. */
export const curveStart = (curve: NumericCurve): number => curve.positions[0]!;

/** The timeline position of a curve's last keyframe. */
export const curveEnd = (curve: NumericCurve): number =>
  curve.positions[curve.positions.length - 1]!;
