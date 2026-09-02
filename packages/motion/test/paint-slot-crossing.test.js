import { describe, it, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { buildCurve, evaluate } from '../src/modules/curve.ts';

wireMotion(paint);

const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 3000, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

const scrollTo = (m, y) => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  m.refresh();
};

afterEach(() => { vi.unstubAllGlobals(); });

/**
 * The paint table is shared by every paint property on the page and deduped by
 * value, so the slots one element uses are **not adjacent**: two elements
 * authored `red -> blue` and `red -> green` take 0,1 and 0,2. Interpolating the
 * second one ran 0 -> 2, and the floor of the middle of that range is 1 — so it
 * painted blue, a colour it never mentions and the first element's.
 *
 * Which is not a paint bug so much as a category error: these values are not on
 * a number line and nothing between two of them means anything. `discrete` on
 * the property is how a module says so, and the runtime then holds each
 * keyframe's value across its segment.
 */
describe('a property whose values are slots, not quantities', () => {
  it('never paints a value the element did not author', () => {
    document.body.innerHTML =
      '<div id="a" data-vera-motion data-vera-motion-inertia="0" ' +
      'data-vera-motion-background="0% red, 100% blue"></div>' +
      '<div id="b" data-vera-motion data-vera-motion-inertia="0" ' +
      'data-vera-motion-background="0% red, 100% green"></div>';
    const a = document.getElementById('a');
    const b = document.getElementById('b');
    place(a);
    place(b);
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    const m = createMotion({ respectReducedMotion: false });
    m.init();

    /**
     * Swept rather than sampled at one point: which scroll position lands
     * mid-segment depends on the measured window, and a single sample that
     * missed it would leave the test green against the original defect.
     */
    const seen = new Set();
    for (let y = 0; y <= 5000; y += 50) {
      scrollTo(m, y);
      seen.add(b.style.getPropertyValue('background'));
    }
    expect([...seen].sort()).toEqual(['green', 'red']);
    /** And the sweep really did cover both of b's own values, not just one. */
    expect(seen.size).toBe(2);
    m.destroy();
  });

  /**
   * The same category error at a second site. A missing end is filled from the
   * property's `initial`, which for paint is the number 0 — and 0 is a *slot*,
   * whichever value the page happened to mint first. It is another element's,
   * and since the table is shared across the five paint properties it need not
   * even be the same kind of value: this animated a `color` to a `background`.
   */
  it('fills a lone keyframe from the element itself, not from slot 0', () => {
    document.body.innerHTML =
      '<div id="a" data-vera-motion data-vera-motion-inertia="0" ' +
      'data-vera-motion-background="0% papayawhip, 100% teal"></div>' +
      '<div id="b" data-vera-motion data-vera-motion-inertia="0" ' +
      'data-vera-motion-color="0% crimson"></div>';
    const a = document.getElementById('a');
    const b = document.getElementById('b');
    place(a);
    place(b);
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    const m = createMotion({ respectReducedMotion: false });
    m.init();

    const seen = new Set();
    for (let y = 0; y <= 5000; y += 50) {
      scrollTo(m, y);
      seen.add(b.style.getPropertyValue('color'));
    }
    /** One authored value holds. It does not travel to somebody else's. */
    expect([...seen]).toEqual(['crimson']);
    m.destroy();
  });

  /**
   * And when every keyframe lives in a band that does not match this width,
   * there is no merged keyframe to rest on either — but the element's own
   * bands still hold its values, which beats slot 0 by the same argument.
   */
  it('rests on the element own value when no band matches', () => {
    document.body.innerHTML =
      '<div id="a" data-vera-motion data-vera-motion-inertia="0" ' +
      'data-vera-motion-background="0% papayawhip, 100% teal"></div>' +
      '<div id="c" data-vera-motion data-vera-motion-inertia="0" ' +
      'data-vera-motion-color="[0-700]: 0% olive, 100% navy"></div>';
    const a = document.getElementById('a');
    const c = document.getElementById('c');
    place(a);
    place(c);
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    const m = createMotion({ respectReducedMotion: false });
    m.init();

    const seen = new Set();
    for (let y = 0; y <= 5000; y += 50) {
      scrollTo(m, y);
      seen.add(c.style.getPropertyValue('color'));
    }
    expect([...seen]).toEqual(['olive']);
    m.destroy();
  });

  it('still steps at the keyframe rather than easing into it', () => {
    const curve = buildCurve([{ position: 0, value: 4 }, { position: 1, value: 9 }], null, true);
    expect(evaluate(curve, 0)).toBe(4);
    expect(evaluate(curve, 0.5)).toBe(4);
    expect(evaluate(curve, 0.99)).toBe(4);
    expect(evaluate(curve, 1)).toBe(9);
  });

  /**
   * The other direction, and the reason `hold` is a flag rather than the new
   * behaviour: every other property in the library is a quantity, and holding
   * one would turn every animation into a hard cut.
   */
  it('leaves an ordinary numeric curve interpolating', () => {
    const curve = buildCurve([{ position: 0, value: 0 }, { position: 1, value: 10 }]);
    expect(evaluate(curve, 0.5)).toBe(5);
  });

  it('holds through the middle keyframe of a three-slot curve', () => {
    const curve = buildCurve(
      [{ position: 0, value: 0 }, { position: 0.5, value: 7 }, { position: 1, value: 2 }],
      null,
      true
    );
    expect(evaluate(curve, 0.25)).toBe(0);
    expect(evaluate(curve, 0.6)).toBe(7);
    expect(evaluate(curve, 1)).toBe(2);
  });
});
