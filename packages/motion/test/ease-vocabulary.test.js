import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { EASING_KEYWORDS, parseEasing } from '../src/modules/schema.ts';
import { resolveEasing } from '../src/easings.ts';

/**
 * Core validates the `ease` vocabulary; `@verajs/motion/easings` implements it.
 * They are separate packages, so nothing makes them agree — and the way they
 * disagree is silent. `resolveCurveEasing` treats a null from a wired module as
 * "this module does not know that one" and falls back to linear without a word,
 * which is right when no module is wired and wrong here: the value passed
 * validation, so the page was promised a curve and got a straight line.
 *
 * Iterating the real `EASING_KEYWORDS` rather than a copy is the whole point.
 * A keyword added to core and not to the module fails here without anyone having
 * to remember this file exists.
 */
describe('the easings module implements everything core accepts', () => {
  it('resolves every keyword', () => {
    const unresolved = EASING_KEYWORDS
      .filter((keyword) => keyword !== 'linear')
      .filter((keyword) => typeof resolveEasing(keyword) !== 'function');
    expect(unresolved).toEqual([]);
  });

  it('leaves linear alone, so the straight-line path stays call-free', () => {
    expect(EASING_KEYWORDS).toContain('linear');
    expect(resolveEasing('linear')).toBeNull();
  });

  /**
   * The two function forms. Each is asserted to pass `parseEasing` first, so
   * if core ever narrows what it accepts this notices that too rather than
   * quietly testing a value no one can write.
   */
  const FORMS = [
    'cubic-bezier(0.42, 0, 0.58, 1)',
    /**
     * Both `y` values outside 0-1, which is legal and is exactly how a springy
     * curve overshoots and settles back. This used to read
     * `cubic-bezier(-0.5, 1.5, 0.5, -0.5)`, whose **x** values are outside the
     * range too — and CSS bounds `x`, so that value was refused by every engine
     * and handed to `inertia-ease` anyway, leaving no transition at all. The
     * parser bounds `x` now; the case is kept for the `y` overshoot it was
     * really about.
     */
    'cubic-bezier(0, 1.5, 1, -0.5)',
    'steps(4)',
    'steps(1, start)',
    'steps(3, end)',
    'steps(5, jump-start)',
    'steps(5, jump-end)',
    'steps(5, jump-none)',
    'steps(5, jump-both)',
  ];

  it.each(FORMS)('resolves %s', (value) => {
    expect(parseEasing(value)).toBe(value);
    expect(resolveEasing(value)).toBeTypeOf('function');
  });

  /**
   * And the `x` bound, which is not symmetric with `y`. CSS requires both `x`
   * co-ordinates in 0-1 — a curve whose `x` leaves the range is not a function
   * of progress at all — while `y` may go anywhere. Accepting an out-of-range
   * `x` meant handing `inertia-ease` a value the CSSOM refuses whole, which
   * leaves no transition and turns inertia silently off.
   *
   * Found by `spikes/steps-validity.mjs`, which compares what this accepts
   * against what three engines do.
   */
  it.each([
    'cubic-bezier(2, 0, 3, 1)',
    'cubic-bezier(-1, 0, 0.5, 1)',
    'cubic-bezier(1.0001, 0, 0.5, 1)',
    'cubic-bezier(0.5, 0, -0.0001, 1)',
  ])('refuses %s, whose x is outside 0-1', (value) => {
    expect(parseEasing(value)).toBeNull();
  });

  /**
   * Every curve is evaluated at both ends of a segment, so a shaper that does
   * not land on 0 and 1 there shifts the keyframe values themselves. The step
   * functions are exempt at the start by definition — `step-start` is 1 the
   * instant it begins, which is what makes it a step.
   */
  it('every non-step keyword spans 0 to 1', () => {
    for (const keyword of EASING_KEYWORDS) {
      if (keyword === 'linear' || keyword.startsWith('step')) continue;
      const shape = resolveEasing(keyword);
      expect(shape(0), keyword).toBeCloseTo(0, 5);
      expect(shape(1), keyword).toBeCloseTo(1, 5);
    }
  });

  it('rejects what core rejects', () => {
    const INVALID = [
      'bounce', 'ease-in-out-back', 'steps()', 'cubic-bezier(0,0,1)', '',
      /** All three engines reject these; `spikes/steps-validity.mjs`. */
      'steps(0)', 'steps(0, end)', 'steps(-1)', 'steps(1, jump-none)',
    ];
    for (const value of INVALID) {
      expect(parseEasing(value)).toBeNull();
      expect(resolveEasing(value)).toBeNull();
    }
  });
});
