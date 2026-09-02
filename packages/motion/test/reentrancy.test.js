/**
 * The public API, called from inside a callback the library invokes.
 *
 * `destroy()` from `onProgress` is not a contrived case: "animate this intro
 * once, then tear the instance down" is an ordinary thing to write, and
 * `onProgress` is the only per-frame hook a page has.
 *
 * The loop read `enabled` on the way in and not again, so a `destroy()` part
 * way through carried on writing styles to every element after that one —
 * *after* teardown had already cleaned them. What was left was an inline
 * transform on the page with no instance left to remove it, on whichever
 * elements happened to sort after the one whose callback fired.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  document.body.innerHTML =
    '<div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>' +
    '<div id="b" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>' +
    '<div id="c" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 90px"></div>';
});
afterEach(() => vi.restoreAllMocks());

const styles = () =>
  ['a', 'b', 'c'].map((id) => document.getElementById(id).getAttribute('style'));

describe('destroy() from inside onProgress', () => {
  it('leaves no element carrying a style the instance can no longer remove', () => {
    let m;
    m = createMotion({ respectReducedMotion: false, inertia: 0, onProgress: () => m.destroy() });
    m.init();
    m.refresh();
    expect(styles()).toEqual([null, null, null]);
  });

  it('and the instance is fully down', () => {
    let m;
    m = createMotion({ respectReducedMotion: false, inertia: 0, onProgress: () => m.destroy() });
    m.init();
    m.refresh();
    expect(m.elements.length).toBe(0);
    expect(m.enabled).toBe(false);
  });
});

describe('disable() from inside onProgress', () => {
  it('stops the pass rather than writing past the teardown', () => {
    let m;
    m = createMotion({ respectReducedMotion: false, inertia: 0, onProgress: () => m.disable() });
    m.init();
    m.refresh();
    expect(styles()).toEqual([null, null, null]);
    expect(m.enabled).toBe(false);
    m.destroy();
  });
});

describe('the ordinary re-entrant calls stay safe', () => {
  it('init() twice, destroy() twice, and init() after destroy()', () => {
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    expect(() => { m.init(); m.init(); }).not.toThrow();
    expect(() => { m.destroy(); m.destroy(); }).not.toThrow();
    expect(() => { m.init(); m.destroy(); }).not.toThrow();
  });

  /**
   * Bounded rather than infinite. It unwinds on its own because each re-entry
   * finds the instance already up to date; the depth is recorded here so a
   * change that makes it unbounded shows up as a stack overflow in this test
   * rather than on someone's page.
   */
  it('refresh() from onProgress terminates', () => {
    let m;
    m = createMotion({
      respectReducedMotion: false, inertia: 0,
      onProgress: () => m.refresh(),
    });
    m.init();
    expect(() => m.refresh()).not.toThrow();
    m.destroy();
  });
});

/**
 * Elements added *after* `init()`, which is the case a GUI editor produces
 * constantly — every edit is a mutation batch, and the batch is painted by its
 * own loop over a local array of the new elements.
 *
 * The same array-iteration failure as the init pass, on the path a GUI hits
 * most. The scroll pass is not vulnerable and has no guard: it iterates the
 * visibility tracker's active **Set**, which teardown clears, so the iteration
 * ends by itself. That was measured rather than assumed, in three engines —
 * see `spikes/reentrant-teardown.mjs`.
 */
describe('destroy() from onProgress while a mutation batch is painting', () => {
  it('writes nothing to the elements after it', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    let m;
    let armed = false;
    m = createMotion({
      respectReducedMotion: false,
      inertia: 0,
      onProgress: () => { if (armed) m.destroy(); },
    });
    m.init();
    armed = true;

    document.getElementById('host').innerHTML =
      '<div id="x" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>' +
      '<div id="y" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>' +
      '<div id="z" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 90px"></div>';
    await new Promise((resolve) => setTimeout(resolve, 20));

    const left = ['x', 'y', 'z']
      .map((id) => document.getElementById(id).getAttribute('style'))
      .filter((style) => style && style.trim());
    expect(left).toEqual([]);
  });
});
