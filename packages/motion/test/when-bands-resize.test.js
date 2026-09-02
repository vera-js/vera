import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * A `when`-driven element with width bands, across a resize.
 *
 * `update()` returns immediately for state-driven elements by design — they are
 * driven by their selector, not by scroll. So a re-measure rebuilt their curves
 * against the new viewport and then repainted nothing: the element kept the
 * previous breakpoint's values until its class next changed. Rotate a phone and
 * the state-driven half of the page is still showing the old band.
 *
 * The resize path did not call `updateState` at all, and `refresh()` called it
 * **unforced** — which returns early on exactly this case, because the
 * selector's answer has not changed. The element is still matched and still at
 * its end; what changed is the curve underneath it.
 */
const P = 'data-vm';

const place = (node) => {
  for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200], ['offsetWidth', 200], ['offsetLeft', 0]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};
const width = (w) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(document.documentElement, 'clientWidth', { value: w, configurable: true });
};
const settle = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const BANDED =
  `<div id="a" ${P} ${P}-when=".on" ` +
  `${P}-translate-y="0% 0px, 100% 40px; [0-700]: 100% 5px"></div>`;

const start = () => {
  document.body.innerHTML = BANDED;
  const node = document.getElementById('a');
  place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return { node, m };
};

describe('a state-driven element with bands', () => {
  it('follows the band across a resize while still matching', async () => {
    width(500);
    const { node, m } = start();
    node.classList.add('on');
    await settle();
    expect(node.style.transform).toBe('translateY(5px)');

    width(1200);
    m.refresh();

    expect(node.style.transform).toBe('translateY(40px)');
    m.destroy();
  });

  it('and back again', async () => {
    width(1200);
    const { node, m } = start();
    node.classList.add('on');
    await settle();
    expect(node.style.transform).toBe('translateY(40px)');

    width(500);
    m.refresh();

    expect(node.style.transform).toBe('translateY(5px)');
    m.destroy();
  });

  /** At rest it follows the band too — the start value is banded as well. */
  it('follows the band while not matching', async () => {
    width(500);
    const { node, m } = start();
    await settle();
    const narrow = node.style.transform;
    width(1200);
    m.refresh();
    expect(node.style.transform).toBe(narrow);
    m.destroy();
  });

  /**
   * Through the real resize listener, not `refresh()`.
   *
   * They are different paths, and the resize one is the one a phone rotation
   * takes: it called `measure(); update();` and nothing else, so a
   * state-driven element was never repainted at all. Two mutations survived a
   * suite that tested only `refresh()`.
   */
  it('follows the band through an actual window resize', async () => {
    width(500);
    const { node, m } = start();
    node.classList.add('on');
    await settle();
    expect(node.style.transform).toBe('translateY(5px)');

    width(1200);
    window.dispatchEvent(new Event('resize'));
    /** `resizeListener` is trailing-debounced at 100ms. */
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(node.style.transform).toBe('translateY(40px)');
    m.destroy();
  });

  /** A scroll-driven element was never affected: `update()` repaints it every frame. */
  it('leaves the scroll-driven case as it was', () => {
    width(500);
    document.body.innerHTML =
      `<div id="b" ${P} ${P}-translate-y="0% 0px, 100% 40px; [0-700]: 100% 5px"></div>`;
    const node = document.getElementById('b');
    place(node);
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const narrow = node.style.transform;
    width(1200);
    m.refresh();
    expect(node.style.transform).not.toBe(narrow);
    m.destroy();
  });
});
