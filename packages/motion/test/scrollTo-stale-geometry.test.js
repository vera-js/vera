/**
 * The two guards against measuring a page that has not finished settling.
 *
 * Targets are measured once, so anything that reflows afterwards makes every
 * stored `start` and `end` a lie. `resizeListener` covers a window resize; these
 * two cover the rest — a `ResizeObserver` on the document element for layout
 * that changes without a resize event, and a `load` listener for the images
 * that are still arriving while the first measurement is taken
 * — an audit finding while it was open.
 *
 * Neither had a test. Both are the kind of guard whose absence is invisible:
 * the page simply tracks the wrong section, occasionally, on slow connections.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let observers, frames, cancelled;

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.disconnected = false;
    observers.push(this);
  }
  observe(target) { this.targets.push(target); }
  disconnect() { this.disconnected = true; }
  fire() { this.callback([]); }
}

const place = (node, top) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const runFrames = () => { const queued = frames; frames = []; queued.forEach((fn) => fn(0)); };

beforeEach(() => {
  observers = []; frames = []; cancelled = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', (handle) => cancelled.push(handle));
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  document.body.innerHTML = '<nav><a id="a" href="#one">1</a></nav><section id="one"></section>';
  place(document.getElementById('one'), 1000);
  Object.defineProperty(window, 'scrollY', { value: 1050, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

const start = () => {
  const s = createScrollTo({ activeClass: 'here', activeThreshold: 0.5 });
  s.init();
  s.update();
  return s;
};
const active = () => document.getElementById('a').classList.contains('here');

describe('the ResizeObserver', () => {
  it('watches the document element', () => {
    const s = start();
    expect(observers).toHaveLength(1);
    expect(observers[0].targets).toEqual([document.documentElement]);
    s.destroy();
  });

  it('re-measures when layout changes without a resize event', () => {
    const s = start();
    expect(active()).toBe(true);

    place(document.getElementById('one'), 5000);
    observers[0].fire();
    runFrames();

    s.update();
    expect(active()).toBe(false);
    s.destroy();
  });

  /** A reflow storm is many callbacks; one frame of work is the point. */
  it('coalesces a burst into a single frame', () => {
    const s = start();
    frames = [];
    observers[0].fire();
    observers[0].fire();
    observers[0].fire();
    expect(frames).toHaveLength(1);
    s.destroy();
  });

  it('is disconnected by destroy, along with any frame it had pending', () => {
    const s = start();
    observers[0].fire();
    s.destroy();
    expect(observers[0].disconnected).toBe(true);
    expect(cancelled.length).toBeGreaterThan(0);
  });
});

describe('the load listener', () => {
  /**
   * Only wired while the document is still loading — a page that has finished
   * has nothing left to reflow, and a `load` event that will never fire is a
   * listener that is never removed.
   */
  it('is not wired once the document is complete', () => {
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    const added = [];
    const native = window.addEventListener.bind(window);
    window.addEventListener = (type, ...rest) => { added.push(type); return native(type, ...rest); };

    const s = start();
    window.addEventListener = native;

    expect(added).not.toContain('load');
    s.destroy();
  });

  it('re-measures on load when the document was still loading', () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const s = start();
    expect(active()).toBe(true);

    place(document.getElementById('one'), 5000);
    window.dispatchEvent(new Event('load'));

    s.update();
    expect(active()).toBe(false);

    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    s.destroy();
  });
});
