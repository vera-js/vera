import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * "Only animate on small screens" is an ordinary thing to want, and the inline
 * spelling has always allowed it — `opacity="[0-700]: 0% 0, 100% 1"` builds a
 * band and no base, silently.
 *
 * The named spelling is the same idea through the attribute name, and it left
 * the parser reading an empty string for the base, which is an empty *value*
 * and refused as one. Both produced identical animations; only one was accused
 * of having no keyframes. `mobile` and `tablet` are registered by default, so
 * `opacity-mobile` on its own is a short walk to it.
 */
const run = (attrs, options = {}) => {
  document.body.innerHTML = `<div data-vera-motion ${attrs}></div>`;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: 3000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 100, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0, ...options });
  m.init();
  const filter = node.style.filter;
  const said = m.rejected.flatMap((r) => r.rejected);
  m.destroy();
  return { filter, said };
};

const width = (px) => {
  Object.defineProperty(document.documentElement, 'clientWidth', { value: px, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true });
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  /** Mid-animation, so a value that ran differs from one that did not. */
  Object.defineProperty(window, 'scrollY', { value: 2700, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 12000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
  width(500);
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('an animation that exists only inside a band', () => {
  it('says nothing when written inline', () => {
    const { filter, said } = run('data-vera-motion-opacity="[0-700]: 0% 0, 100% 1"');
    expect(filter).toBe('opacity(0.5)');
    expect(said).toEqual([]);
  });

  it('and says nothing written as a name either', () => {
    const { filter, said } = run(
      'data-vera-motion-opacity-small="0% 0, 100% 1"',
      { breakpoints: { small: [0, 700] } }
    );
    expect(filter).toBe('opacity(0.5)');
    expect(said).toEqual([]);
  });

  it('with the default breakpoints, which is the short walk to it', () => {
    const { said } = run('data-vera-motion-opacity-mobile="0% 0, 100% 1"');
    expect(said).toEqual([]);
  });

  /** Outside its band it simply does not animate, which is the point of a band. */
  it('does nothing outside the band, without complaining', () => {
    width(1200);
    const { said } = run(
      'data-vera-motion-opacity-small="0% 0, 100% 1"',
      { breakpoints: { small: [0, 700] } }
    );
    expect(said).toEqual([]);
  });

  /**
   * And an attribute that really is empty is still refused — the base being
   * *absent* is a shape, the base being *blank* is a mistake.
   */
  it('while a base written as nothing is still refused', () => {
    const { said } = run(
      'data-vera-motion-opacity="" data-vera-motion-opacity-small="0% 0, 100% 1"',
      { breakpoints: { small: [0, 700] } }
    );
    expect(said).toEqual(['opacity: no keyframes']);
  });
});
