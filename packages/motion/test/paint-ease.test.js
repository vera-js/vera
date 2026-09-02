import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { easings } from '../src/easings.ts';

wireMotion([paint, easings]);

/**
 * `ease` cannot reach a held curve, and that is a property of what easing *is*
 * rather than a gap.
 *
 * An easing reshapes progress **within a segment**, the way `@keyframes`
 * applies a timing function. A `discrete` curve has one value from end to end
 * of each segment, and the boundaries are the keyframe positions, which no
 * easing moves — so the colour changes at the keyframe whatever curve is
 * asked for.
 *
 * Pinned because it looks exactly like a bug, and because the alternative
 * reading — "the easing is being dropped somewhere" — would send the next
 * reader into `evaluate`'s `hold` branch to add it.
 */
const P = 'data-vm';

const place = (node) => {
  for (const [key, value] of [['offsetTop', 1000], ['offsetLeft', 0], ['offsetWidth', 200], ['offsetHeight', 200]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const COLOURS = '0% red, 50% green, 100% blue';

describe('`ease` beside a held property', () => {
  it('changes nothing about when the colour lands', () => {
    document.body.innerHTML =
      `<div id="plain" ${P} ${P}-background="${COLOURS}"></div>` +
      `<div id="eased" ${P} ${P}-ease="ease-in" ${P}-background="${COLOURS}"></div>`;
    for (const node of document.querySelectorAll('div')) place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    const colour = (id) => {
      const node = document.getElementById(id);
      return node.style.background || node.style.backgroundColor;
    };
    for (const y of [700, 900, 1100, 1300]) {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
      m.refresh();
      expect(colour('eased'), `at scroll ${y}`).toBe(colour('plain'));
    }
    m.destroy();
  });

  /** And it still shapes a numeric property on the same element. */
  it('while still shaping a numeric property beside it', () => {
    document.body.innerHTML =
      `<div id="plain" ${P} ${P}-background="${COLOURS}" ${P}-translate-y="0% 0px, 100% 100px"></div>` +
      `<div id="eased" ${P} ${P}-ease="ease-in" ${P}-background="${COLOURS}" ` +
      `${P}-translate-y="0% 0px, 100% 100px"></div>`;
    for (const node of document.querySelectorAll('div')) place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true });
    m.refresh();

    expect(document.getElementById('eased').style.transform)
      .not.toBe(document.getElementById('plain').style.transform);
    m.destroy();
  });

  /** Not refused: an `ease` on such an element is not wrong. */
  it('and is not reported', () => {
    document.body.innerHTML = `<div ${P} ${P}-ease="ease-in" ${P}-background="${COLOURS}"></div>`;
    for (const node of document.querySelectorAll('div')) place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.rejected).toEqual([]);
    m.destroy();
  });
});
