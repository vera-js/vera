import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { resolveEasing } from '../src/easings.ts';

/**
 * An independent solver, deliberately not the one under test: bisection on
 * `x(t)` for 200 halvings, which is slow, obviously correct, and shares no code
 * with `bezier`. A test that reimplemented Newton-Raphson would agree with the
 * bug.
 *
 * The browser is the real oracle — `spikes/easing-oracle.mjs` compares against
 * three engines — but a defect this size should not need a browser to notice,
 * and for ten months it did.
 */
const reference = (x1, y1, x2, y2) => (progress) => {
  const x = (t) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
  const y = (t) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (x(mid) < progress) low = mid;
    else high = mid;
  }
  return y((low + high) / 2);
};

/**
 * The first four are the keywords. The rest are the shapes where `x'(t)`
 * approaches zero inside the range — which is not where Newton-Raphson stalls,
 * as the code used to claim, but where it leaves the interval entirely.
 */
const CURVES = [
  [0.25, 0.1, 0.25, 1],
  [0.42, 0, 1, 1],
  [0, 0, 0.58, 1],
  [0.42, 0, 0.58, 1],
  [0.68, -0.55, 0.27, 1.55],
  [1, 0, 0, 1],
  [1, 0, 1, 0],
  [0, 0, 0, 1],
  [1, 0, 1, 1],
  [1, 1, 1, 0],
  [1, 1, 0, 0],
  [0.9, 0, 1, 0.1],
  [0.99, 0.01, 0.01, 0.99],
  [0, 1, 1, 0],
];

describe('the bezier solver against an independent one', () => {
  for (const control of CURVES) {
    it(`cubic-bezier(${control.join(', ')})`, () => {
      const ours = resolveEasing(`cubic-bezier(${control.join(',')})`);
      const truth = reference(...control);
      let worst = 0;
      for (let i = 0; i <= 200; i++) {
        worst = Math.max(worst, Math.abs(ours(i / 200) - truth(i / 200)));
      }
      /**
       * Bisection stops at 2^-20 in `t`, and a steep segment multiplies that
       * into `y`. 1e-4 is comfortably inside it and nowhere near the 8,900 and
       * 2.7e5 that six of these curves used to return.
       */
      expect(worst).toBeLessThan(1e-4);
    });
  }

  /**
   * The bound above is the point of the test, so it is worth stating what it
   * would have been: `cubic-bezier(1, 0, 0, 1)` returned 8,900 at the midpoint
   * against a true value of 0.5.
   */
  it('stays inside the authored range for a curve whose control points do', () => {
    const ease = resolveEasing('cubic-bezier(1, 0, 0, 1)');
    for (let i = 0; i <= 200; i++) {
      const out = ease(i / 200);
      expect(out).toBeGreaterThan(-0.001);
      expect(out).toBeLessThan(1.001);
    }
  });

  /** A y outside [0, 1] is legal and *should* overshoot — but by its own amount. */
  it('overshoots only as far as the control points ask', () => {
    const ease = resolveEasing('cubic-bezier(0.68, -0.55, 0.27, 1.55)');
    let low = 0;
    let high = 0;
    for (let i = 0; i <= 200; i++) {
      low = Math.min(low, ease(i / 200));
      high = Math.max(high, ease(i / 200));
    }
    expect(low).toBeGreaterThan(-0.2);
    expect(high).toBeLessThan(1.2);
  });
});

/**
 * `resolveEasing` returns null for anything it does not recognise, and the
 * table it consults used to be an object literal — so five inherited keys
 * looked up truthy and were spread into `bezier`, throwing a TypeError out of
 * it. Core cannot reach this (`parseEasing` matches an array first), but the
 * function is a published export of `@verajs/motion/easings`.
 */
describe('a name that is not an easing', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    it(`returns null for "${name}"`, () => {
      expect(resolveEasing(name)).toBeNull();
    });
  }
});

/**
 * The step position is an allowlist, exactly as core's `parseEasing` has it.
 * Loose matching meant `steps(3, bogus)` quietly behaved as `end` — a
 * published export answering wrong instead of answering null.
 */
describe('a step position that is not one', () => {
  for (const value of ['steps(3, bogus)', 'steps(3, jump)', 'steps(3, startx)']) {
    it(`returns null for "${value}"`, () => {
      expect(resolveEasing(value)).toBeNull();
    });
  }

  it('still resolves every real position', () => {
    for (const position of ['start', 'end', 'jump-start', 'jump-end', 'jump-none', 'jump-both']) {
      expect(resolveEasing(`steps(3, ${position})`)).not.toBeNull();
    }
  });
});
