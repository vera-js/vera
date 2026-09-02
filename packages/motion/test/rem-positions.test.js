import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * A keyframe position in `rem`, and what happens when the root font size
 * changes under it.
 *
 * `rem` is a position unit like `vh` and `px`, so `40rem` is a distance of
 * scroll — and unlike the others it resolves against something a page can
 * change at runtime: `html { font-size }`, which a great many themes set
 * responsively. `readRootFontSize` reads it once per measure pass, and
 * `refreshCurves` divides by it.
 *
 * Nothing exercised it. `readRootFontSize` is exported, drives every `rem`
 * position in the library, and was mentioned by no test and no mutation — so a
 * version that read the size once at import, or hard-coded 16, would have
 * passed everything.
 */
const P = 'data-vera-motion';

const place = (node) => {
  for (const [key, value] of [['offsetTop', 1000], ['offsetHeight', 200], ['offsetWidth', 200], ['offsetLeft', 0]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const rootFontSize = (px) => { document.documentElement.style.fontSize = `${px}px`; };
const scrollTo = (y) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
});
afterEach(() => {
  document.documentElement.style.fontSize = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const start = (value) => {
  document.body.innerHTML = `<div id="a" ${P} ${P}-translate-y="${value}"></div>`;
  const node = document.getElementById('a');
  place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return { node, m };
};

describe('a keyframe position in rem', () => {
  it('resolves against the root font size', () => {
    rootFontSize(16);
    const { node, m } = start('0rem 0px, 40rem 100px');
    scrollTo(900);
    m.refresh();
    /** 40rem at 16px is 640px of scroll window; the element is 93.75% through it. */
    expect(node.style.transform).toBe('translateY(93.75px)');
    m.destroy();
  });

  /**
   * The half that needs the read to happen *per measure pass*. A root font
   * size read once, at import or at init, leaves every `rem` position frozen
   * at whatever the page started with — and `html { font-size }` moving with
   * the viewport is ordinary in a responsive theme.
   */
  it('follows the root font size when it changes', () => {
    rootFontSize(16);
    const { node, m } = start('0rem 0px, 40rem 100px');
    scrollTo(900);
    m.refresh();
    const at16 = node.style.transform;

    rootFontSize(32);
    m.refresh();

    /** 40rem is now 1,280px, so the same scroll is half as far through. */
    expect(node.style.transform).not.toBe(at16);
    expect(node.style.transform).toBe('translateY(46.875px)');
    m.destroy();
  });

  it('and says nothing about it, because there is nothing wrong with it', () => {
    rootFontSize(16);
    const { m } = start('0rem 0px, 40rem 100px');
    expect(m.rejected).toEqual([]);
    m.destroy();
  });
});
