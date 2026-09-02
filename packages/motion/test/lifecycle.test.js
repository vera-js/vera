import { describe, it } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { split } from '../src/split.ts';
import { sequence } from '../src/sequence.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

wireMotion([split, sequence]);

const settle = () => new Promise((r) => setTimeout(r, 0));
const MARKUP = '<div data-vm data-vm-opacity="0% 0, 100% 1" data-vm-translate-y="0% 10px, 100% 0px"></div>';

describe('deferred frames are cancelled by teardown', () => {
  /**
   * Every one of these modules coalesces re-measuring into one frame. A
   * deferred frame with no canceller is the leak shape that has shipped four
   * times (a failure mode this repo has hit before), and it is invisible to a listener
   * count because nothing is listening — the frame is simply already queued.
   *
   * ids must stay stable across the whole run. An earlier version of this test
   * truncated the captured array, which made a later cancel(1) null an
   * unrelated entry and reported a pass it had not earned.
   */
  const captureFrames = () => {
    const frames = [];
    const real = { raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
    globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
    globalThis.cancelAnimationFrame = (id) => {
      if (id >= 1 && id <= frames.length) frames[id - 1] = null;
    };
    return {
      frames,
      pendingSince: (mark) => frames.slice(mark).filter(Boolean).length,
      restore: () => {
        globalThis.requestAnimationFrame = real.raf;
        globalThis.cancelAnimationFrame = real.cancel;
      },
    };
  };

  it('the runtime cancels a queued remeasure on destroy', () => {
    vi.useFakeTimers();
    document.body.innerHTML = MARKUP;
    const cap = captureFrames();

    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const mark = cap.frames.length;

    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(150);
    expect(cap.pendingSince(mark)).toBe(1);

    a.destroy();
    expect(cap.pendingSince(mark)).toBe(0);

    cap.restore();
    vi.useRealTimers();
  });

  /**
   * The transition write a **mutation batch** defers, which had no canceller at
   * all: `start()` kept its own in a slot and `applyChanges` threw its away. A
   * `destroy()` landing between the batch and the next frame therefore stripped
   * the element's transition and then had it written straight back — an inline
   * style left on the page for the life of the document, by the teardown whose
   * job is to remove it.
   *
   * The first probe of this reported no bug, because its `requestAnimationFrame`
   * stub reset its ids between frames and `destroy()`'s cancel of a spent id
   * landed on the live one. This file's own helper carries a comment about the
   * same trap, one test above.
   */
  it('the runtime cancels a mutation batch transition write on destroy', async () => {
    document.body.innerHTML = MARKUP;
    const cap = captureFrames();
    /** Runs what is queued from `from` on, without ever shortening the array. */
    const runFrom = (from) => {
      for (let i = from; i < cap.frames.length; i++) {
        const frame = cap.frames[i];
        cap.frames[i] = null;
        frame?.();
      }
    };

    const m = createMotion({ respectReducedMotion: false, inertia: 0.4 });
    m.init();
    /** Land the init write, so what is measured next is the batch's own. */
    runFrom(0);
    const node = document.querySelector('[data-vm]');
    expect(node.style.transition, 'the transition must land before it can be written back').not.toBe('');
    node.style.transition = '';
    const mark = cap.frames.length;

    node.setAttribute('data-vm-translate-y', '0% 0px, 100% 80px');
    await settle();
    expect(cap.pendingSince(mark), 'the batch queued a write').toBeGreaterThan(0);

    m.destroy();
    runFrom(mark);

    expect(node.style.transition).toBe('');
    cap.restore();
  });

  it('scroll-to cancels a queued refresh on destroy', () => {
    document.body.innerHTML = '<a href="#t">go</a><div id="t"></div>';
    let notify;
    class FakeResizeObserver {
      constructor(cb) { notify = cb; }
      observe() {}
      disconnect() { notify = null; }
    }
    const realRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = FakeResizeObserver;
    const cap = captureFrames();

    const s = createScrollTo();
    s.init();
    const mark = cap.frames.length;

    notify();
    expect(cap.pendingSince(mark)).toBe(1);

    s.destroy();
    expect(cap.pendingSince(mark)).toBe(0);

    cap.restore();
    globalThis.ResizeObserver = realRO;
  });
});

describe('lifecycle churn', () => {
  it('100 init/destroy cycles leak no listeners', () => {
    document.body.innerHTML = MARKUP;
    const added = new Map();
    for (const target of [window, document]) {
      const real = target.addEventListener.bind(target);
      const off = target.removeEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation((...a) => {
        added.set(target, (added.get(target) ?? 0) + 1); return real(...a);
      });
      vi.spyOn(target, 'removeEventListener').mockImplementation((...a) => {
        added.set(target, (added.get(target) ?? 0) - 1); return off(...a);
      });
    }
    for (let i = 0; i < 100; i++) {
      const a = createMotion({ respectReducedMotion: false });
      a.init();
      a.destroy();
    }
    for (const [, net] of added) expect(net).toBeLessThanOrEqual(0);
    vi.restoreAllMocks();
  });

  it('rapid enable/disable leaves exactly one consistent state', () => {
    document.body.innerHTML = MARKUP;
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    for (let i = 0; i < 50; i++) { a.disable(); a.enable(); }
    expect(a.enabled).toBe(true);
    a.disable();
    expect(a.enabled).toBe(false);
    const node = document.querySelector('div');
    expect(node.style.transform).toBe('');
    a.destroy();
  });

  it('destroy during an in-flight sequence load does not draw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML =
      '<canvas data-vm data-vm-frame="0% 0, 100% 9" data-vm-frame-url="/s/" data-vm-frame-count="10"></canvas>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    a.destroy();
    await settle();
    await settle();
    expect(a.elements).toHaveLength(0);
    warn.mockRestore();
  });

  /**
   * There is no in-flight window any more. `@verajs/motion/split` is wired
   * rather than fetched, so splitting is synchronous and gated on whether
   * anything will animate — the class of bug this test was written for (a
   * chunk landing after disable() and shredding the paragraph anyway) cannot
   * happen. What remains true, and is checked in split-lifecycle, is that a
   * page which will not animate is never split at all.
   */
  it('leaves a disabled instance holding no live splits', async () => {
    document.body.innerHTML =
      '<p data-vm data-vm-split="words" data-vm-opacity="0% 0, 100% 1">the quick fox</p>';
    const node = document.querySelector('p');
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    await settle();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);

    /** disable() no longer rewrites the page back; destroy() does. */
    a.disable();
    a.destroy();
    expect(node.innerHTML).toBe('the quick fox');
  });

  it('init twice is a no-op, not a double registration', () => {
    document.body.innerHTML = MARKUP;
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    a.init();
    expect(a.elements).toHaveLength(1);
    a.destroy();
  });

  it('observe() the same root twice registers it once', async () => {
    document.body.innerHTML = '';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const root = document.createElement('div');
    root.innerHTML = MARKUP;
    document.body.appendChild(root);
    a.observe(root);
    await settle();
    a.observe(root);
    await settle();
    expect(a.elements).toHaveLength(1);
    a.destroy();
  });

  it('unobserve() removes only that root elements', async () => {
    document.body.innerHTML = '<div id="keep">' + MARKUP + '</div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const extra = document.createElement('div');
    extra.innerHTML = MARKUP;
    document.body.appendChild(extra);
    a.observe(extra);
    await settle();
    expect(a.elements).toHaveLength(2);
    a.unobserve(extra);
    await settle();
    expect(a.elements).toHaveLength(1);
    a.destroy();
  });
});
