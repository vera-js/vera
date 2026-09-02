/**
 * A consumer callback that throws is a consumer bug, and it used to be the
 * whole page's problem.
 *
 * `onProgress` is the one option whose value the library *invokes* rather than
 * reads. `motion.ts` already guards the non-function case, and says why: the
 * exception left `init()` and took the instance with it. A function that throws
 * did exactly the same thing and was not guarded — so a bug in a callback about
 * one element's progress left every element on the page unanimated, and stopped
 * the consumer's own script at the `init()` call.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

let warnings;
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
});
afterEach(() => vi.restoreAllMocks());

const page = () => {
  document.body.innerHTML =
    '<div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>' +
    '<div id="b" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';
};

describe('onProgress that throws', () => {
  it('does not escape init()', () => {
    page();
    const m = createMotion({
      respectReducedMotion: false,
      inertia: 0,
      onProgress: () => { throw new Error('consumer bug'); },
    });
    expect(() => m.init()).not.toThrow();
    m.destroy();
  });

  it('leaves every other element animating', () => {
    page();
    const m = createMotion({
      respectReducedMotion: false,
      inertia: 0,
      onProgress: () => { throw new Error('consumer bug'); },
    });
    m.init();
    m.refresh();
    /** The instance is alive and its elements were adopted, which is what the throw used to prevent. */
    expect(m.elements.length).toBe(2);
    expect(m.enabled).toBe(true);
    m.destroy();
  });

  it('is dropped after the first throw rather than called every frame', () => {
    page();
    let calls = 0;
    const m = createMotion({
      respectReducedMotion: false,
      inertia: 0,
      onProgress: () => { calls++; throw new Error('consumer bug'); },
    });
    m.init();
    const afterFirst = calls;
    for (let i = 0; i < 5; i++) m.refresh();
    expect(calls).toBe(afterFirst);
    expect(calls).toBeGreaterThan(0);
    m.destroy();
  });

  it('says so exactly once', () => {
    page();
    const m = createMotion({
      respectReducedMotion: false,
      inertia: 0,
      onProgress: () => { throw new Error('consumer bug'); },
    });
    m.init();
    for (let i = 0; i < 5; i++) m.refresh();
    expect(warnings.filter((w) => w.includes('onProgress threw'))).toHaveLength(1);
    m.destroy();
  });

  /**
   * And in `rejected`, not only the console. Dropping `onProgress` takes a
   * whole feature away for the life of the page; the GUI renders `rejected`
   * and cannot read a console, which is the same reason the non-function case
   * above is recorded there.
   */
  it('records it where a GUI can read it', () => {
    page();
    const m = createMotion({
      respectReducedMotion: false,
      inertia: 0,
      onProgress: () => { throw new Error('consumer bug'); },
    });
    m.init();
    for (let i = 0; i < 5; i++) m.refresh();
    const config = m.rejected.filter((entry) => entry.node === null);
    expect(config).toHaveLength(1);
    expect(config[0].rejected).toEqual(['onProgress threw, so it is being ignored from here on.']);
    m.destroy();
  });

  /** Nothing to report while it is working. */
  it('and a callback that does not throw is called as often as before', () => {
    page();
    let calls = 0;
    const m = createMotion({
      respectReducedMotion: false,
      inertia: 0,
      onProgress: () => { calls++; },
    });
    m.init();
    const afterInit = calls;
    m.refresh();
    expect(calls).toBeGreaterThan(afterInit - 1);
    expect(warnings.filter((w) => w.includes('onProgress'))).toEqual([]);
    expect(m.rejected).toEqual([]);
    m.destroy();
  });

  it('still ignores a non-function, with its own message', () => {
    page();
    const m = createMotion({ respectReducedMotion: false, inertia: 0, onProgress: 'nope' });
    expect(() => m.init()).not.toThrow();
    expect(warnings.some((w) => w.includes('onProgress is not a function'))).toBe(true);
    m.destroy();
  });
});
