import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { scrollListener, resizeListener } from '../src/modules/eventListeners.js';

/**
 * Deterministic frame clock. The real rAF is replaced so "one callback per
 * frame" can be asserted exactly rather than inferred from timing.
 */
let queue, nextHandle, realRaf, realCaf;

const flushFrame = () => {
  const batch = queue;
  queue = [];
  batch.forEach(([, fn]) => fn());
};

beforeEach(() => {
  queue = [];
  nextHandle = 0;
  realRaf = globalThis.requestAnimationFrame;
  realCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => { const h = ++nextHandle; queue.push([h, fn]); return h; };
  globalThis.cancelAnimationFrame = (h) => { queue = queue.filter(([q]) => q !== h); };
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCaf;
});

const makeTarget = () => {
  const handlers = [];
  return {
    handlers,
    addEventListener: (type, fn, opts) => handlers.push({ type, fn, opts }),
    removeEventListener: (type, fn) => {
      const i = handlers.findIndex((h) => h.type === type && h.fn === fn);
      if (i > -1) handlers.splice(i, 1);
    },
    scroll: () => handlers.filter((h) => h.type === 'scroll').forEach((h) => h.fn()),
  };
};

describe('scrollListener', () => {
  it('registers a passive scroll listener', () => {
    const target = makeTarget();
    scrollListener(target, () => {});
    expect(target.handlers).toHaveLength(1);
    expect(target.handlers[0].type).toBe('scroll');
    expect(target.handlers[0].opts).toEqual({ passive: true });
  });

  it('runs the callback once per frame, however many events arrive', () => {
    const target = makeTarget();
    const cb = vi.fn();
    scrollListener(target, cb);

    for (let i = 0; i < 20; i++) target.scroll();
    expect(cb).not.toHaveBeenCalled();   // nothing runs until the frame
    expect(queue).toHaveLength(1);       // and only one frame is ever queued

    flushFrame();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('runs exactly once per frame across continuous scrolling', () => {
    const target = makeTarget();
    const cb = vi.fn();
    scrollListener(target, cb);

    /** 3 events per frame for 10 frames — the realistic case. */
    for (let f = 0; f < 10; f++) {
      target.scroll(); target.scroll(); target.scroll();
      flushFrame();
    }
    expect(cb).toHaveBeenCalledTimes(10);
  });

  it('never drops a frame that had any scroll activity', () => {
    const target = makeTarget();
    const cb = vi.fn();
    scrollListener(target, cb);

    for (let f = 0; f < 50; f++) { target.scroll(); flushFrame(); }
    expect(cb).toHaveBeenCalledTimes(50);
  });

  it('does not queue work for a frame with no scrolling', () => {
    const target = makeTarget();
    const cb = vi.fn();
    scrollListener(target, cb);

    target.scroll();
    flushFrame();
    flushFrame();
    flushFrame();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('re-arms after the frame runs', () => {
    const target = makeTarget();
    const cb = vi.fn();
    scrollListener(target, cb);

    target.scroll(); flushFrame();
    target.scroll(); flushFrame();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('removeScrollListener detaches the handler', () => {
    const target = makeTarget();
    const cb = vi.fn();
    const { removeScrollListener } = scrollListener(target, cb);

    removeScrollListener();
    expect(target.handlers).toHaveLength(0);
    target.scroll();
    flushFrame();
    expect(cb).not.toHaveBeenCalled();
  });

  it('removeScrollListener cancels a frame that is already queued', () => {
    const target = makeTarget();
    const cb = vi.fn();
    const { removeScrollListener } = scrollListener(target, cb);

    target.scroll();
    expect(queue).toHaveLength(1);

    removeScrollListener();
    expect(queue).toHaveLength(0);

    flushFrame();
    expect(cb).not.toHaveBeenCalled();
  });

  it('defaults to window when given no element', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    scrollListener(null, () => {});
    expect(spy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    spy.mockRestore();
  });
});


describe('resizeListener', () => {
  /**
   * The previous version scheduled a fresh timer for every resize event and
   * cancelled none of them, so a window drag ran the callback once per event
   * and a timer could still fire after destroy(). `scrollListener` guards both;
   * these two sit ten lines apart.
   */
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once for a burst of events, not once each', () => {
    const cb = vi.fn();
    const { removeResizeListener } = resizeListener(cb);
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
    removeResizeListener();
  });

  it('runs again for a later burst', () => {
    const cb = vi.fn();
    const { removeResizeListener } = resizeListener(cb);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(2);
    removeResizeListener();
  });

  it('cancels a pending callback on teardown', () => {
    const cb = vi.fn();
    const { removeResizeListener } = resizeListener(cb);
    window.dispatchEvent(new Event('resize'));
    removeResizeListener();
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
  });

  it('stops listening after teardown', () => {
    const cb = vi.fn();
    const { removeResizeListener } = resizeListener(cb);
    removeResizeListener();
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
  });
});
