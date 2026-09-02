import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

let observers;

/** happy-dom has no layout, so the tracker's reports are driven by hand. */
class FakeIO {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    observers.push(this);
  }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  report(target, isIntersecting) { this.callback([{ target, isIntersecting }]); }
}

const geometry = (node, top, height) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

afterEach(() => vi.unstubAllGlobals());

/**
 * An element with `display: none` has no box at all — `offsetHeight` 0 and
 * `offsetParent` null — so it measures as sitting at the top of the document
 * with no height, and its timeline position lands past the end before anyone
 * has scrolled. It paints its *last* keyframe.
 *
 * Revealing it in the page changes the document's height, which the
 * `ResizeObserver` catches. Revealing it inside a fixed-height scroller changes
 * nothing the library watches: measured in all three engines
 * (`spikes/revealed.mjs`), such an element sat at `opacity(1)` while 3,501px
 * below the viewport, for good.
 */
describe('an element measured while it had no box', () => {
  const build = () => {
    document.body.innerHTML =
      '<div id="a" data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.getElementById('a');
    /** Hidden: what a browser reports for `display: none`. */
    geometry(node, 0, 0);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    return { m, node };
  };

  it('measures as past its own end while hidden, which is why this matters', () => {
    const { m, node } = build();
    expect(m.elements[0].size).toBe(0);
    expect(node.style.transform).toBe('translateY(40px)');
    m.destroy();
  });

  it('re-measures when the tracker first reports it', () => {
    const { m, node } = build();

    /** The panel opens: a real box, well below the fold. */
    geometry(node, 3000, 200);
    observers.at(-1).report(node, true);

    expect(m.elements[0].size).toBe(200);
    expect(m.elements[0].start).toBe(3000);
    /** Below the fold now, so its *first* keyframe rather than its last. */
    expect(node.style.transform).toBe('translateY(0px)');
    m.destroy();
  });

  /**
   * Only on the way in. A report that the element has left is the moment it
   * stops being updated, and re-measuring there would pay for geometry nobody
   * is about to look at.
   */
  it('does not re-measure on the way out', () => {
    const { m, node } = build();
    geometry(node, 3000, 200);
    observers.at(-1).report(node, false);
    expect(m.elements[0].size).toBe(0);
    m.destroy();
  });

  /**
   * And an element that had a box all along is not re-measured, which is what
   * keeps this off the ordinary path: `size === 0` is the whole signature.
   */
  it('leaves an element that was measured properly alone', () => {
    document.body.innerHTML =
      '<div id="b" data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.getElementById('b');
    geometry(node, 3000, 200);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    /** Moved, but never re-measured, because it never carried the signature. */
    geometry(node, 9000, 200);
    observers.at(-1).report(node, true);
    expect(m.elements[0].start).toBe(3000);
    m.destroy();
  });
});
