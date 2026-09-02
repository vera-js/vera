/**
 * A poisoned rAF timestamp must not hang the tween.
 *
 * No engine delivers a non-finite stamp; a wrapped requestAnimationFrame can
 * (zone.js, test doubles). A NaN first stamp seeded `startTime`, every
 * `elapsed` became NaN, and `elapsed >= duration` was never true — the loop
 * scheduled forever and `onComplete` never fired, the same endless-tween
 * failure `durationFor` guards against from the option side.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let frames;
beforeEach(() => {
  document.body.innerHTML = '';
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

const tick = (t) => { for (const fn of frames.splice(0)) fn(t); };

describe('a non-finite rAF timestamp', () => {
  it('is skipped, and the tween still completes on the next real one', () => {
    const writes = [];
    vi.spyOn(window, 'scrollTo').mockImplementation((x, y) => writes.push(y));
    const s = createScrollTo({ duration: 100 });
    let done = 0;
    s.toPosition(1000, { onComplete: () => done++ });

    tick(NaN);
    expect(writes, 'the poisoned frame writes nothing').toHaveLength(0);
    tick(16); tick(60); tick(200);
    expect(done, 'completes against the recovered clock').toBe(1);
    expect(writes.at(-1)).toBe(1000);
    expect(frames, 'and stops scheduling').toHaveLength(0);
    s.destroy();
  });
});
