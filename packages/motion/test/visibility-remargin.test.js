import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

let instances;

class FakeIO {
  constructor(_callback, options) {
    this.options = options;
    this.targets = new Set();
    instances.push(this);
  }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
}

const place = (node, top, height) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const setViewport = (height) => {
  Object.defineProperty(document.documentElement, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
};

/** `resizeListener` debounces by 100ms, so a shorter wait tests nothing. */
const afterResize = async () => {
  window.dispatchEvent(new Event('resize'));
  await new Promise((r) => setTimeout(r, 250));
};

beforeEach(() => {
  instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => vi.unstubAllGlobals());

/**
 * The root margin is in pixels, and pixels do not correct themselves.
 *
 * While it was a percentage the observer resolved it against the current root
 * every time, so a resize fixed it for free — and the tracker was rebuilt only
 * when some element was `geometryDependent`, which was the only thing that
 * could change the margin. In pixels the margin is built from the root's size
 * and each element's own, so any re-measure can invalidate it, and a page whose
 * keyframe positions are all `%` has no geometry-dependent element at all.
 */
describe('the root margin after a resize', () => {
  const build = () => {
    setViewport(700);
    document.body.innerHTML =
      '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';
    place(document.body.firstElementChild, 3000, 200);
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    return m;
  };

  it('follows the viewport on a page with no geometry-dependent element', async () => {
    const m = build();
    expect(instances.at(-1).options.rootMargin).toBe('350px 0px 350px 0px');

    setViewport(1400);
    await afterResize();
    expect(instances.at(-1).options.rootMargin).toBe('700px 0px 700px 0px');
    m.destroy();
  });

  it('and rebuilds the observer rather than leaving the old one watching', async () => {
    const m = build();
    const first = instances.at(-1);
    setViewport(1400);
    await afterResize();
    expect(instances.length).toBe(2);
    /** The replaced one lets go of its targets; the new one holds them. */
    expect(first.targets.size).toBe(0);
    expect(instances.at(-1).targets.size).toBe(1);
    m.destroy();
  });

  /**
   * `%` positions are not geometry-dependent, which is the whole point: this
   * element is the one the old gate skipped.
   */
  it('the element under test really is not geometry-dependent', () => {
    const m = build();
    expect(m.elements[0].geometryDependent).toBe(false);
    m.destroy();
  });
});

/**
 * And after an element arrives that reaches further than the margin was built
 * for.
 *
 * The margin is computed from the elements present when the tracker is built,
 * and an `IntersectionObserver`'s `rootMargin` is fixed at construction. Every
 * path that adopts an element rebuilds the tracker afterwards — `init()`,
 * `collect()`, `observe()` — except the one an editor actually uses: the
 * mutation observer. So a block added to a page of `0%-100%` elements, with
 * keyframes reaching outside that range, was watched with a margin that knew
 * nothing about it and reported as gone while it was still animating. That is
 * the failure the margin exists to prevent, arriving by the one door left open.
 *
 * In a browser with a `ResizeObserver` it was already answered a frame later
 * and by accident: `add()` observes the new element's box, the first delivery
 * is guaranteed, and `measure()` retracks. happy-dom has no such observer, so
 * this suite sees the uncovered path directly — which is the one §12 calls a
 * degrade, and `spikes/late-element.mjs` measures at 0.837 of an animation
 * that reaches 1.
 */
describe('the root margin after an element is added', () => {
  const build = (markup) => {
    setViewport(700);
    document.body.innerHTML = markup;
    for (const node of document.querySelectorAll('div')) place(node, 3000, 200);
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    return m;
  };

  const add = async (positions) => {
    const node = document.createElement('div');
    node.setAttribute('data-vera-motion', '');
    node.setAttribute('data-vera-motion-translate-y', positions);
    document.body.appendChild(node);
    place(node, 5000, 200);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };

  const PLAIN = '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';

  it('grows to cover it', async () => {
    const m = build(PLAIN);
    expect(instances.at(-1).options.rootMargin).toBe('350px 0px 350px 0px');

    /** 200px tall in a 700px viewport: one timeline unit is 900px either side. */
    await add('-100% 0px, 200% 40px');

    expect(instances.at(-1).options.rootMargin).toBe('1250px 0px 1250px 0px');
    expect(m.elements).toHaveLength(2);
    m.destroy();
  });

  /**
   * Both edges, because an element can reach further back without reaching
   * further forward — and `covers` compared against one of them for a while
   * without the suite noticing.
   */
  it('grows behind as well as ahead', async () => {
    const m = build(PLAIN);

    await add('-200% 0px, 100% 40px');

    expect(instances.at(-1).options.rootMargin).toBe('350px 0px 2150px 0px');
    expect(m.elements).toHaveLength(2);
    m.destroy();
  });

  /**
   * The forward edge on its own, which is what the pair of tests above cannot
   * see: both add an element reaching further *behind*, so a `covers` that
   * asked about that edge alone answered them correctly. Here the page already
   * reaches 100% behind and the added element reaches only ahead.
   */
  it('and ahead of one that reaches no further behind', async () => {
    const m = build(
      '<div data-vera-motion data-vera-motion-translate-y="-100% 0px, 100% 40px"></div>'
    );
    expect(instances.at(-1).options.rootMargin).toBe('350px 0px 1250px 0px');

    await add('0% 0px, 200% 40px');

    expect(instances.at(-1).options.rootMargin).toBe('1250px 0px 1250px 0px');
    m.destroy();
  });

  /**
   * And does not rebuild for one the margin already reaches. `retrack()`
   * disconnects the observer and re-observes every element on the page, and
   * this runs on every mutation batch — an editor produces a great many.
   */
  it('and leaves the observer alone for one it already covers', async () => {
    const m = build(PLAIN);
    const before = instances.length;

    await add('0% 0px, 100% 40px');

    expect(instances.length).toBe(before);
    expect(m.elements).toHaveLength(2);
    m.destroy();
  });
});
