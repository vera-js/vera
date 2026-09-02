import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, EVENTS } from '../src/index.ts';

const P = 'data-vera-motion';
const place = (node, top = 500) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};
const scrollTo = (y) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
const settle = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((r) => setTimeout(r, 30));
};

beforeEach(() => { document.body.innerHTML = ''; scrollTo(0); });
afterEach(() => { vi.restoreAllMocks(); });

/**
 * The instance methods are public and a page can call them in any order — a
 * framework's cleanup runs `destroy()` on a component that never mounted, a
 * hot reload calls `init()` twice, an unmount races a scroll. None of these is
 * exotic, and every one of them is a way to reach the runtime in a state it
 * was not written for.
 */
describe('the public methods tolerate any order', () => {
  const build = () => {
    document.body.innerHTML = `<div ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>`;
    place(document.body.firstElementChild);
    return createMotion({ respectReducedMotion: false, inertia: 0 });
  };

  it('accepts every method before init()', () => {
    const m = build();
    expect(() => {
      m.destroy();
      m.refresh();
      m.collect();
      m.disable();
      m.enable();
      m.unobserve(document.createElement('div'));
    }).not.toThrow();
    /** And none of that half-started it. */
    expect(m.elements).toHaveLength(0);
  });

  it('accepts every method after destroy(), and comes back on init()', () => {
    const m = build();
    m.init();
    expect(m.elements).toHaveLength(1);
    expect(() => {
      m.destroy();
      m.destroy();
      m.refresh();
      m.collect();
      m.enable();
    }).not.toThrow();
    expect(m.elements).toHaveLength(0);

    m.init();
    expect(m.elements).toHaveLength(1);
    m.destroy();
  });

  /**
   * Counting elements is not enough here, and the first version of this test
   * did only that. `adopt` dedupes by node, so a second `init()` and a
   * redundant `observe()` both leave `elements` at 1 whatever the guards do —
   * the test passed with either guard removed. What a doubled `init()`
   * actually costs is a second set of listeners and a second observer, so
   * those are what to count.
   */
  it('treats a second init() as a no-op, listeners included', () => {
    const scrollListeners = () => added.filter(([type]) => type === 'scroll').length;
    const added = [];
    vi.spyOn(window, 'addEventListener').mockImplementation(function (...args) {
      added.push(args);
    });

    const m = build();
    m.init();
    expect(scrollListeners()).toBe(1);
    m.init();
    expect(scrollListeners(), 'a second init must not attach a second listener').toBe(1);
    expect(m.elements).toHaveLength(1);
    m.destroy();
  });

  /**
   * Two roots that genuinely overlap, which the case below does not test: it
   * observes `document` again, and `roots` is a set, so nothing is added. Here
   * the second root is a node *inside* the first, so every element under it is
   * scanned twice and reaches the parse path twice.
   *
   * The guard in `adopt` reads as the thing that prevents this and is now
   * unreachable — `reparse` drops before it re-adopts. What enforces it is the
   * `Set` the batch is built into, and nothing was asking about that.
   */
  it('registers an element under two overlapping roots once', () => {
    document.body.innerHTML =
      '<div id="outer"><div id="inner">' +
      '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>' +
      '</div></div>';
    const m = createMotion({ respectReducedMotion: false, root: document.getElementById('outer') });
    m.init();
    expect(m.elements).toHaveLength(1);

    m.observe(document.getElementById('inner'));

    expect(m.elements, 'the element is inside both roots').toHaveLength(1);
    const nodes = m.elements.map((element) => element.node);
    expect(new Set(nodes).size).toBe(nodes.length);
    m.destroy();
  });

  it('treats a redundant observe() as a no-op, observers included', () => {
    const observed = [];
    const realObserve = MutationObserver.prototype.observe;
    vi.spyOn(MutationObserver.prototype, 'observe').mockImplementation(function (...args) {
      observed.push(args[0]);
      return realObserve.apply(this, args);
    });

    const m = build();
    m.init();
    const before = observed.filter((target) => target === document).length;
    m.observe(document);
    expect(observed.filter((target) => target === document).length,
      'observing the existing root again must not watch it twice').toBe(before);
    expect(m.elements).toHaveLength(1);
    m.destroy();
  });
});

/**
 * Events and `onProgress` hand control to the page in the middle of the
 * runtime's own loop. "When this finishes, tear it down" is an obvious thing
 * to write, and it re-enters every structure the loop is walking.
 */
describe('a listener may re-enter the runtime', () => {
  it('survives destroy() called from a complete listener', async () => {
    document.body.innerHTML =
      `<div ${P} ${P}-run-once ${P}-translate-y="0% 0px, 100% 120px"></div>` +
      `<div ${P} ${P}-run-once ${P}-translate-y="0% 0px, 100% 120px"></div>`;
    for (const node of document.querySelectorAll('div')) place(node, 0);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    const onComplete = () => m.destroy();
    document.addEventListener(EVENTS.complete, onComplete);
    scrollTo(5000);
    expect(() => m.refresh()).not.toThrow();
    await settle();

    expect(m.elements).toHaveLength(0);
    document.removeEventListener(EVENTS.complete, onComplete);
  });

  it('survives an element removing itself from onProgress', async () => {
    document.body.innerHTML =
      `<div ${P} ${P}-translate-y="0% 0px, 100% 120px"></div>` +
      `<div ${P} ${P}-translate-y="0% 0px, 100% 120px"></div>`;
    for (const node of document.querySelectorAll('div')) place(node, 0);
    const m = createMotion({
      respectReducedMotion: false,
      inertia: 0,
      onProgress: (node) => node.remove(),
    });
    expect(() => m.init()).not.toThrow();
    scrollTo(2000);
    expect(() => m.refresh()).not.toThrow();
    await settle();
    m.destroy();
  });
});
