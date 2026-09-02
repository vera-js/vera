import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

let resizeObservers;

/** happy-dom reports no layout, so the observer is driven by hand. */
class FakeRO {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    resizeObservers.push(this);
  }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); this.disconnected = true; }
  report() { this.callback([]); }
}

const geometry = (node, top, height) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  resizeObservers = [];
  vi.stubGlobal('ResizeObserver', FakeRO);
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

afterEach(() => vi.unstubAllGlobals());

const build = (markup, top = 3000, height = 200) => {
  document.body.innerHTML = markup;
  const node = document.body.firstElementChild;
  geometry(node, top, height);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return { m, node };
};

const MARKUP = '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';

/**
 * Three things ask for a re-measure: the `load` listener, a `ResizeObserver` on
 * the document element, and one on the scroll container. None of them sees an
 * element whose own box changes after load inside a container that does not
 * itself resize — an accordion's open transition, a lazy image below the fold,
 * a font swapping, an embed sizing itself.
 *
 * Measured in all three engines (`spikes/box-change.mjs`): an element grown
 * from 100px to 700px by a CSS animation — which produces no mutation record
 * at all — kept its cached size of 100 and painted 0.698 where 0.317 was right.
 */
describe('an element whose own box changes', () => {
  it('is watched, along with the document and the container', () => {
    const { m, node } = build(MARKUP);
    expect(resizeObservers).toHaveLength(1);
    expect(resizeObservers[0].targets.has(node)).toBe(true);
    expect(resizeObservers[0].targets.has(document.documentElement)).toBe(true);
    m.destroy();
  });

  it('re-measures when the observer reports', () => {
    const { m, node } = build(MARKUP);
    expect(m.elements[0].size).toBe(200);

    geometry(node, 3000, 700);
    resizeObservers[0].report();

    expect(m.elements[0].size).toBe(700);
    m.destroy();
  });

  /**
   * The other half of the pairing: an element that leaves stops being watched,
   * or the observer keeps a reference to a node the page has thrown away.
   */
  it('lets go of an element removed from the page', async () => {
    const { m, node } = build(MARKUP);
    expect(resizeObservers[0].targets.has(node)).toBe(true);

    node.remove();
    /** The mutation observer reports on a microtask. */
    await new Promise((r) => setTimeout(r, 0));

    expect(resizeObservers[0].targets.has(node)).toBe(false);
    m.destroy();
  });

  it('and disconnects the whole thing on destroy', () => {
    const { m } = build(MARKUP);
    m.destroy();
    expect(resizeObservers[0].disconnected).toBe(true);
  });

  it('watches an element adopted after init', () => {
    const { m } = build(MARKUP);
    document.body.insertAdjacentHTML('beforeend',
      '<div id="late" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>');
    const late = document.getElementById('late');
    geometry(late, 6000, 200);
    m.collect();
    expect(resizeObservers[0].targets.has(late)).toBe(true);
    m.destroy();
  });
});
