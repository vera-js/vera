/**
 * One update per frame, however many scroll events arrive.
 *
 * `scrollListener` is a dirty flag rather than a throttle, and its docblock
 * argues the case at length — a throttle drops updates and lands them out of
 * step with paint, while without any flag every scroll event queues its own
 * frame and several run within one, doing identical work repeatedly.
 *
 * Both halves of that were argued and neither was counted. A scroll event
 * fires far more often than a frame, so the difference between one queued
 * frame and ten is the whole cost of tracking while someone scrolls.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let frames;

const place = (node, top) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const scrolls = (count) => {
  for (let i = 0; i < count; i++) window.dispatchEvent(new Event('scroll'));
};
const runQueued = () => { const queued = frames; frames = []; queued.forEach((fn) => fn(0)); };

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  document.body.innerHTML = '<nav><a id="a" href="#one">1</a></nav><section id="one"></section>';
  place(document.getElementById('one'), 1000);
});
afterEach(() => vi.unstubAllGlobals());

describe('the scroll listener', () => {
  it('queues one frame for a burst of events', () => {
    const s = createScrollTo();
    s.init();
    frames = [];

    scrolls(10);

    expect(frames).toHaveLength(1);
    s.destroy();
  });

  /** The flag has to clear, or the listener works once and then never again. */
  it('queues again once that frame has run', () => {
    const s = createScrollTo();
    s.init();
    frames = [];

    scrolls(10);
    runQueued();
    scrolls(3);

    expect(frames).toHaveLength(1);
    s.destroy();
  });

  /**
   * Each instance keeps its own flag, so two of them do two updates rather than
   * sharing one — which is correct, and worth stating: they track different
   * links and one cannot stand in for the other.
   */
  it('coalesces per instance, not globally', () => {
    const a = createScrollTo();
    const b = createScrollTo();
    a.init();
    b.init();
    frames = [];

    scrolls(10);

    expect(frames).toHaveLength(2);
    a.destroy();
    b.destroy();
  });

  it('queues nothing once destroyed', () => {
    const s = createScrollTo();
    s.init();
    s.destroy();
    frames = [];

    scrolls(10);

    expect(frames).toHaveLength(0);
  });
});
