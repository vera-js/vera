/**
 * A duration that is not a number.
 *
 * `NaN` is the value worth guarding here, and it is what `parseInt` of a config
 * value produces — the animation runtime guards its `priority` for exactly that
 * reason. This did not merely misbehave, it hung: `duration <= 0` is false for
 * NaN so the tween began, `elapsed` became NaN on the first frame, and
 * `elapsed >= duration` is never true, so the loop rescheduled itself forever
 * while writing a NaN scroll position every frame.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let queue, handle, now, scrolled, warnings;
const flush = (frames = 200) => {
  for (let i = 0; i < frames && queue.length; i++) {
    const batch = queue; queue = []; now += 16.7;
    batch.forEach(([, fn]) => fn(now));
  }
};

beforeEach(() => {
  queue = []; handle = 0; now = 0; scrolled = []; warnings = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => { const h = ++handle; queue.push([h, fn]); return h; });
  vi.stubGlobal('cancelAnimationFrame', (h) => { queue = queue.filter(([q]) => q !== h); });
  vi.stubGlobal('scrollTo', vi.fn((x, y) => {
    scrolled.push(y);
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  }));
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  document.body.innerHTML = '<nav><a href="#one">one</a></nav><section id="one"></section>';
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a duration that is NaN', () => {
  it('arrives instead of looping forever', () => {
    const s = createScrollTo({ duration: Number.parseInt('fast', 10) });
    s.init();
    const done = vi.fn();
    s.toPosition(1000, { onComplete: done });
    flush();

    expect(scrolled.at(-1)).toBe(1000);
    expect(done).toHaveBeenCalled();
    s.destroy();
  });

  /** The hang is the point: unguarded, the queue never drains. */
  it('leaves no frame scheduled', () => {
    const s = createScrollTo({ duration: NaN });
    s.init();
    s.toPosition(1000);
    flush();
    expect(queue).toHaveLength(0);
    s.destroy();
  });

  it('never writes a NaN position', () => {
    const s = createScrollTo({ duration: NaN });
    s.init();
    s.toPosition(1000);
    flush();
    expect(scrolled.every((y) => Number.isFinite(y))).toBe(true);
    s.destroy();
  });

  it('is reported at init, like the other configuration mistakes', () => {
    const s = createScrollTo({ duration: NaN });
    s.init();
    expect(s.rejected).toEqual([
      { node: null, reason: 'duration NaN (number) is not a number; arriving at once' },
    ]);
    expect(warnings.filter((w) => w.includes('not a number'))).toHaveLength(1);
    s.destroy();
  });

  it('and a per-call duration is guarded too', () => {
    const s = createScrollTo({ duration: 300 });
    s.init();
    expect(s.rejected).toEqual([]);
    s.toPosition(1000, { duration: NaN });
    flush();
    expect(scrolled.at(-1)).toBe(1000);
    expect(s.rejected).toHaveLength(1);
    s.destroy();
  });
});

describe('durations that are numbers', () => {
  it('say nothing — zero, negative and positive alike', () => {
    for (const duration of [0, -50, 300]) {
      const s = createScrollTo({ duration });
      s.init();
      expect(s.rejected, `duration ${duration}`).toEqual([]);
      s.destroy();
    }
  });

  /** Zero and negative both mean "arrive now", which was already true. */
  it('and a negative one still arrives at once', () => {
    const s = createScrollTo({ duration: -50 });
    s.init();
    s.toPosition(1000);
    flush();
    expect(scrolled).toEqual([1000]);
    s.destroy();
  });
});

/**
 * The **type**, not just the value.
 *
 * `toPosition('500')` was refused as "is not a number: 500", which reads as
 * nonsense to whoever wrote it — the value printed is exactly what they passed
 * and it plainly *is* a number to look at. A string that looks numeric is what
 * a GUI and a PHP template both produce, so it is the likeliest way to get
 * here, and the one the old message explained worst.
 */
describe('a value that looks like a number and is not one', () => {
  it('names the type in the destination refusal', () => {
    const s = createScrollTo({ respectReducedMotion: false });
    s.init();
    s.toPosition('500');
    expect(s.rejected.map((problem) => problem.reason).join(' | '))
      .toContain('is not a number: 500 (string)');
    s.destroy();
  });

  it('and in the duration one', () => {
    const s = createScrollTo({ respectReducedMotion: false, duration: '900' });
    s.init();
    expect(s.rejected.map((problem) => problem.reason).join(' | '))
      .toContain('duration 900 (string) is not a number');
    s.destroy();
  });
});
