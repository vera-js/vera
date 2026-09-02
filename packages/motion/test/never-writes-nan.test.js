import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { easings } from '../src/easings.ts';

/**
 * Whatever the page is shaped like, the runtime never writes a style the CSSOM
 * will silently drop.
 *
 * This is the invariant behind a whole class of defect rather than one bug. An
 * SVG `<rect>` was adopted and written `transform: translateY(NaNpx)` every
 * frame — no SVG interface has `offsetTop`, so its geometry read back `null` —
 * and the declaration was dropped by the engine, so nothing moved, nothing was
 * reported, and the attributes looked correct in devtools. A value that is
 * *invalid* is the quietest possible failure: unlike a wrong number, it leaves
 * no trace at all.
 *
 * So the assertion is not about any one shape. Every shape below is put through
 * a scroll sweep, and no inline style written by the runtime may contain `NaN`,
 * `Infinity` or `undefined` — the three ways a number becomes a string that
 * parses as nothing.
 *
 * happy-dom has no layout, so the geometry here is declared rather than real.
 * What is being tested is arithmetic on the numbers the runtime is given,
 * including the ones a real engine would also give it: `0`, and absent.
 */
const P = 'data-vm';

wireMotion([paint, easings]);

const ANIMATED =
  `${P}-translate-y="0% 0px, 100% 40px" ${P}-opacity="0% 0, 100% 1" ` +
  `${P}-blur="0% 0px, 100% 4px" ${P}-radius="0% 0px, 100% 8px" ` +
  `${P}-background="0% rgb(1,2,3), 100% rgb(4,5,6)"`;

/**
 * Each shape is a way an element can be laid out — or fail to be. The point of
 * the list is breadth: a zero box, no box at all, a missing `offsetParent`, a
 * geometry-dependent position that has to divide by something, and an element
 * the library refuses outright.
 */
const SHAPES = {
  'ordinary block': (node) => size(node, 500, 200),
  'zero height': (node) => size(node, 500, 0),
  'zero everything': (node) => size(node, 0, 0),
  'no geometry at all': () => {},
  'negative offsetTop': (node) => size(node, -400, 200),
  'enormous offsetTop': (node) => size(node, 1e9, 200),
  'height larger than the page': (node) => size(node, 0, 1e7),
};

const size = (node, top, height) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

/** Every inline style the runtime has written on anything under `body`. */
const written = () =>
  [...document.querySelectorAll('*')]
    .map((node) => node.getAttribute('style') ?? '')
    .join(' | ');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const sweep = (m) => {
  const seen = [];
  for (const y of [0, 1, 400, 1200, 5000, 1e6]) {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    m.refresh();
    seen.push(written());
  }
  return seen.join(' || ');
};

describe('no shape makes the runtime write a value that is not a value', () => {
  for (const [name, lay] of Object.entries(SHAPES)) {
    it(`${name}: writes nothing containing NaN, Infinity or undefined`, () => {
      document.body.innerHTML = `<div id="s" ${P} ${ANIMATED}></div>`;
      lay(document.getElementById('s'));
      Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
      const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
      m.init();
      const styles = sweep(m);
      m.destroy();
      expect(styles).not.toMatch(/NaN/);
      expect(styles).not.toMatch(/Infinity/);
      expect(styles).not.toMatch(/undefined/);
    });
  }

  /**
   * A page that cannot scroll, which is where every ratio has a zero in its
   * denominator: `scrollWindow`, the element's own size, and the reach the
   * timeline divides by.
   */
  it('and neither does a page with nothing to scroll', () => {
    document.body.innerHTML = `<div id="s" ${P} ${ANIMATED}></div>`;
    size(document.getElementById('s'), 0, 0);
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 800, configurable: true });
    const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
    m.init();
    const styles = sweep(m);
    m.destroy();
    expect(styles).not.toMatch(/NaN|Infinity|undefined/);
  });

  /**
   * And the shape that started this: an element the library cannot measure at
   * all. It is refused now, and what this asserts is the consequence — refusing
   * means writing nothing, not writing something invalid.
   */
  it('and an element it refuses is left completely alone', () => {
    document.body.innerHTML =
      `<svg viewBox="0 0 10 10"><rect id="s" ${P} ${ANIMATED} width="4" height="4"/></svg>`;
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
    const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
    m.init();
    const styles = sweep(m);
    m.destroy();
    expect(styles).not.toMatch(/NaN|Infinity|undefined/);
    expect(document.getElementById('s').getAttribute('style')).toBeNull();
  });
});
