import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { easings } from '../src/easings.ts';

wireMotion(easings);

/**
 * `ease` shapes the curve **between** keyframes, and a `when` element is never
 * between them: it sits at `lowestStart` or `highestEnd` and steps from one to
 * the other. The easing is evaluated at an endpoint every time, where it cannot
 * change the answer — so `ease` on a `when` element does nothing at all, and
 * said nothing about it.
 *
 * That is the same shape as `stagger` on a `when` element, which is refused for
 * the same reason and was found the same way, and it lands on the attribute
 * an earlier audit already called "the most likely thing in the whole
 * attribute set to be misread".
 */
const P = 'data-vera-motion';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  /** `setTransitions` defers by a frame, so the transition lands only if one runs. */
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const place = (node) => {
  for (const [key, value] of [['offsetTop', 1000], ['offsetHeight', 200], ['offsetWidth', 200]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const build = (attrs, { scrollY = 0, inertia = 0 } = {}) => {
  document.body.innerHTML =
    `<div class="on" ${P} ${attrs} ${P}-translate-y="0% 0px, 100% 100px" ` +
    /** Both categories, or `filter-inertia` has nothing to be a duration for. */
    `${P}-opacity="0% 0, 100% 1"></div>`;
  const node = document.body.firstElementChild;
  place(node);
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia });
  m.init();
  return { node, m };
};
const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

describe('`ease` on a `when` element', () => {
  it('is reported, because it can never shape anything', () => {
    const { node, m } = build(`${P}-when=".on" ${P}-ease="ease-in-out"`);

    expect(node.style.transform, 'held at the end, not interpolated').toBe('translateY(100px)');
    expect(reasons(m)).toContain('-ease does nothing on a');
    expect(reasons(m), 'and names the one that does work').toContain('inertia-ease');
    m.destroy();
  });

  /**
   * The control that makes the refusal mean something: without `when`, the same
   * `ease` bends the value away from the straight line.
   */
  it('while the same easing shapes a scrolled element', () => {
    const eased = build(`${P}-ease="ease-in-out"`, { scrollY: 1100 });
    const linear = build('', { scrollY: 1100 });

    expect(eased.node.style.transform).not.toBe(linear.node.style.transform);
    expect(eased.m.rejected).toEqual([]);
    eased.m.destroy();
    linear.m.destroy();
  });
});

/**
 * And the three that are **not** inert, which is why only `ease` is refused.
 * `inertia-ease` shapes the *change* between the two states and is handed to
 * CSS, so it reaches a `when` element exactly as it reaches a scrolled one.
 */
describe('what a `when` element can still use', () => {
  for (const [name, value, expected] of [
    ['inertia-ease', 'ease-in', 'ease-in'],
    ['transform-inertia', '0.9', '0.9s'],
    ['filter-inertia', '0.8', '0.8s'],
  ]) {
    it(`${name} still reaches it`, () => {
      const { node, m } = build(`${P}-when=".on" ${P}-${name}="${value}"`, { inertia: 0.3 });

      expect(node.style.transition).toContain(expected);
      expect(m.rejected, 'and nothing is refused').toEqual([]);
      m.destroy();
    });
  }
});

/**
 * The neighbouring pair of the same two attributes, found by asking the
 * question a recurring failure mode is about: `ease` beside `when` was fixed on
 * its own, and nobody asked what else `inertia-ease` sits beside.
 *
 * `inertia-ease` shapes the **catch-up**, and at `inertia: 0` there is none.
 * `transitionFor` builds a transition per animated category, skips every one
 * whose speed is 0, and returns `null` when none is left — so the easing string
 * is read out of the settings and dropped. Inert, and silent for as long as
 * `ease` was.
 */
describe('`inertia-ease` with nothing to ease', () => {
  it('is reported when the element sets inertia to 0', () => {
    const { node, m } = build(`${P}-inertia="0" ${P}-inertia-ease="ease-in-out"`, { inertia: 0.4 });
    expect(node.style.transition, 'nothing to shape').toBe('');
    expect(reasons(m)).toContain('-inertia-ease does nothing at');
    m.destroy();
  });

  /**
   * And when the *instance* does, which is the same mistake one level up and
   * the reason `ParseContext` carries `inertia`: an element that writes none
   * inherits it, so deciding from the element's own attributes would miss this.
   */
  it('and when the instance sets it, with the element writing none', () => {
    const { m } = build(`${P}-inertia-ease="ease-in-out"`, { inertia: 0 });
    expect(reasons(m)).toContain('-inertia-ease does nothing at');
    m.destroy();
  });

  /**
   * A per-category override rescues it: `speedFor` reads the override before
   * the base, so the transform still transitions and the easing still shapes
   * that. Saying anything here would be wrong.
   */
  it('but not when a category override brings the catch-up back', () => {
    const { node, m } = build(
      `${P}-inertia="0" ${P}-transform-inertia="0.3" ${P}-inertia-ease="ease-in-out"`,
      { inertia: 0 }
    );
    expect(node.style.transition, 'the transform still catches up').toContain('transform');
    expect(reasons(m)).not.toContain('-inertia-ease does nothing at');
    m.destroy();
  });

  /** And nothing is said when there is a catch-up for it to shape. */
  it('and says nothing at a non-zero inertia', () => {
    const { m } = build(`${P}-inertia="0.4" ${P}-inertia-ease="ease-in-out"`, { inertia: 0 });
    expect(reasons(m)).not.toContain('-inertia-ease does nothing at');
    m.destroy();
  });
});
