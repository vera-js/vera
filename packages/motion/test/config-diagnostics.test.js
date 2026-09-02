/**
 * A mistake in the *configuration* reaches `instance.rejected`, not only the
 * console.
 *
 * A GUI editor renders `rejected` and cannot read a console — and it is the
 * thing most likely to write a bad option, because it generates them. Every
 * option the runtime validates and falls back on used to be reported only to
 * the console, so the one reader that needed it was the one reader that could
 * not see it.
 *
 * `scroll-to` has reported its own configuration this way since it gained
 * diagnostics. This is the same contract on the other entry point, and the
 * reason `RejectedElement.node` is nullable.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

let warnings;
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
  document.body.innerHTML =
    '<div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
});
afterEach(() => vi.restoreAllMocks());

/** The one entry with no element, if there is one. */
const config = (m) => m.rejected.find((entry) => entry.node === null);

describe('an option the runtime refused', () => {
  it('reports an unusable ease, inertia and inertiaEase, each naming itself', () => {
    const m = createMotion({
      respectReducedMotion: false,
      ease: 'not-an-easing',
      inertia: Number.NaN,
      inertiaEase: 'wobble',
    });
    m.init();
    const reasons = config(m).rejected;
    expect(reasons.some((r) => r.startsWith('ease '))).toBe(true);
    expect(reasons.some((r) => r.startsWith('inertia '))).toBe(true);
    expect(reasons.some((r) => r.startsWith('inertiaEase '))).toBe(true);
    m.destroy();
  });

  it('reports a non-callable onProgress', () => {
    const m = createMotion({ respectReducedMotion: false, onProgress: 'nope' });
    m.init();
    expect(config(m).rejected).toEqual([expect.stringContaining('onProgress is not a function')]);
    m.destroy();
  });

  it('reports a scrollElement selector that matched nothing', () => {
    const m = createMotion({ respectReducedMotion: false, scrollElement: '#nowhere' });
    m.init();
    expect(config(m).rejected).toEqual([expect.stringContaining('no element matched scrollElement')]);
    m.destroy();
  });

  it('and one that is not valid CSS, differently', () => {
    const m = createMotion({ respectReducedMotion: false, scrollElement: 'a[' });
    m.init();
    const reasons = config(m).rejected;
    expect(reasons).toEqual([expect.stringContaining('not valid CSS')]);
    expect(reasons[0]).not.toContain('no element matched');
    m.destroy();
  });

  it('still warns as well, so devtools shows it without reading an array', () => {
    const m = createMotion({ respectReducedMotion: false, onProgress: 'nope' });
    m.init();
    expect(warnings.some((w) => w.includes('onProgress is not a function'))).toBe(true);
    m.destroy();
  });
});

describe('the shape of the list', () => {
  it('carries at most one entry with no node, and it sorts first', () => {
    document.body.innerHTML =
      '<div id="bad" data-vera-motion data-vera-motion-nonsense="1" ' +
      'data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const m = createMotion({ respectReducedMotion: false, ease: 'not-an-easing', inertia: Number.NaN });
    m.init();
    const nulls = m.rejected.filter((entry) => entry.node === null);
    expect(nulls).toHaveLength(1);
    expect(m.rejected[0].node).toBeNull();
    /** And the element's own problem is still there, after it. */
    expect(m.rejected.length).toBeGreaterThan(1);
    m.destroy();
  });

  it('says nothing when the configuration is fine', () => {
    const m = createMotion({ respectReducedMotion: false, inertia: 0.2, ease: 'linear' });
    m.init();
    expect(m.rejected.filter((entry) => entry.node === null)).toEqual([]);
    m.destroy();
  });
});
