import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { resolveEasing } from '../src/easings.ts';

/**
 * `resolveEasing` only ever sees strings that have already passed
 * `parseEasing`, so these cover the shapes that grammar admits — not hostile
 * input, which is `schema.test.js`'s job.
 */
describe('resolveEasing', () => {
  /**
   * Null, not an identity function. The caller branches on it so a straight
   * line stays a bare multiply, which is what keeps curve easing free on a
   * page that has not asked for it.
   */
  it('resolves linear to null so the straight-line path costs nothing', () => {
    expect(resolveEasing('linear')).toBeNull();
  });

  it.each(['ease', 'ease-in', 'ease-out', 'ease-in-out'])('resolves the keyword %s', (name) => {
    const ease = resolveEasing(name);
    expect(ease).toBeTypeOf('function');
    expect(ease(0)).toBeCloseTo(0, 3);
    expect(ease(1)).toBeCloseTo(1, 3);
  });

  it('matches the CSS definition of ease-in — slow to leave, fast to arrive', () => {
    const ease = resolveEasing('ease-in');
    expect(ease(0.25)).toBeLessThan(0.25);
    expect(ease(0.75)).toBeLessThan(0.75);
    /** cubic-bezier(0.42, 0, 1, 1) at x=0.5 is ~0.3153. */
    expect(ease(0.5)).toBeCloseTo(0.3153, 2);
  });

  it('matches the CSS definition of ease-out — fast to leave, slow to arrive', () => {
    const ease = resolveEasing('ease-out');
    expect(ease(0.25)).toBeGreaterThan(0.25);
    expect(ease(0.5)).toBeCloseTo(0.6847, 2);
  });

  it('is monotonic through the middle for the standard keywords', () => {
    for (const name of ['ease', 'ease-in', 'ease-out', 'ease-in-out']) {
      const ease = resolveEasing(name);
      let previous = -Infinity;
      for (let x = 0; x <= 1.0001; x += 0.05) {
        const y = ease(x);
        expect(y, `${name} at ${x.toFixed(2)}`).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = y;
      }
    }
  });

  it('solves an arbitrary cubic-bezier', () => {
    const ease = resolveEasing('cubic-bezier(0.42, 0, 0.58, 1)');
    expect(ease(0)).toBeCloseTo(0, 4);
    expect(ease(0.5)).toBeCloseTo(0.5, 3);   // symmetric curve
    expect(ease(1)).toBeCloseTo(1, 4);
  });

  /**
   * A control point above 1 carries the value past its target and back. This
   * is the whole reason the curve easing takes CSS timing functions rather
   * than a fixed table of named easings — springiness comes for free.
   */
  it('overshoots when a control point does', () => {
    const ease = resolveEasing('cubic-bezier(0.34, 1.56, 0.64, 1)');
    let peak = 0;
    for (let x = 0; x <= 1; x += 0.01) peak = Math.max(peak, ease(x));
    expect(peak).toBeGreaterThan(1);
    expect(ease(1)).toBeCloseTo(1, 3);
  });

  it('makes a staircase of steps(n, end)', () => {
    const ease = resolveEasing('steps(4, end)');
    expect(ease(0)).toBe(0);
    expect(ease(0.1)).toBe(0);
    expect(ease(0.3)).toBeCloseTo(0.25, 6);
    expect(ease(0.6)).toBeCloseTo(0.5, 6);
    expect(ease(0.9)).toBeCloseTo(0.75, 6);
    expect(ease(1)).toBe(1);
  });

  it('starts on the first step for steps(n, start)', () => {
    const ease = resolveEasing('steps(4, start)');
    expect(ease(0)).toBeCloseTo(0.25, 6);
    expect(ease(0.3)).toBeCloseTo(0.5, 6);
    expect(ease(1)).toBe(1);
  });

  it('defaults a bare steps(n) to end, as CSS does', () => {
    const bare = resolveEasing('steps(4)');
    const explicit = resolveEasing('steps(4, end)');
    for (const x of [0, 0.2, 0.45, 0.8, 1]) expect(bare(x)).toBeCloseTo(explicit(x), 9);
  });

  it('treats step-start and step-end as one-step staircases', () => {
    expect(resolveEasing('step-start')(0)).toBe(1);
    expect(resolveEasing('step-end')(0.99)).toBe(0);
    expect(resolveEasing('step-end')(1)).toBe(1);
  });

  it('never returns a value outside 0..1 for steps', () => {
    for (const spec of ['steps(3, start)', 'steps(3, end)', 'steps(3, jump-none)', 'steps(3, jump-both)']) {
      const ease = resolveEasing(spec);
      for (let x = 0; x <= 1.0001; x += 0.02) {
        expect(ease(x), `${spec} at ${x.toFixed(2)}`).toBeGreaterThanOrEqual(0);
        expect(ease(x), `${spec} at ${x.toFixed(2)}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
