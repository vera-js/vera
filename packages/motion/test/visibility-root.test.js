/**
 * The tracker observes against the container it was given.
 *
 * With no root the observer measures against the viewport, and an element
 * inside a scrolling container is reported as gone the moment that container
 * scrolls it out of view — **however large `rootMargin` is**, because the
 * margin expands the viewport rectangle and the clipping happens below it. So
 * the element clamped mid-animation, which is precisely what the margin exists
 * to prevent.
 *
 * Measured in Chromium (`spikes/tracker-margin.mjs`): an element in a
 * horizontal pane, keyframes reaching -100% to 200%, froze at 0.68 and never
 * finished. With the container as the root it runs to 1.
 *
 * Only the option can be asserted here — a fake observer cannot clip — so the
 * effect lives in the harness and this holds the wiring.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

let observers;

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    observers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const place = (node) => {
  Object.defineProperty(node, 'offsetTop', { value: 100, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

const build = (options) => {
  document.body.innerHTML =
    '<div id="pane"><div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></div>';
  place(document.querySelector('[data-vera-motion]'));
  const m = createMotion({ respectReducedMotion: false, ...options });
  m.init();
  return m;
};

describe('the observer root', () => {
  it('is the scroll container when there is one', () => {
    const pane = () => document.getElementById('pane');
    const m = build({ scrollElement: '#pane' });
    expect(observers).toHaveLength(1);
    expect(observers[0].options.root).toBe(pane());
    m.destroy();
  });

  /** Only an element can be a root, so the window has to be null, not itself. */
  it('is null for the window', () => {
    const m = build({});
    expect(observers[0].options.root).toBeNull();
    m.destroy();
  });

  it('is the container when it was passed as a node rather than a selector', () => {
    document.body.innerHTML =
      '<div id="pane"><div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></div>';
    place(document.querySelector('[data-vera-motion]'));
    const pane = document.getElementById('pane');
    const m = createMotion({ respectReducedMotion: false, scrollElement: pane });
    m.init();
    expect(observers[0].options.root).toBe(pane);
    m.destroy();
  });

  /**
   * The margin is still computed and still goes on the scrolled axis. In
   * pixels: a timeline unit is the element plus the root, so a percentage of
   * the root alone falls short by the element's own size.
   */
  it('comes with the margin, not instead of it', () => {
    const m = build({ scrollElement: '#pane' });
    expect(observers[0].options.rootMargin).toMatch(/^\d+px 0px \d+px 0px$/);
    m.destroy();
  });
});
