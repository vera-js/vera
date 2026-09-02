/**
 * A wired module that throws must not take the rest of the chain with it.
 *
 * Insert points chain rather than replace because two modules commonly want the
 * same one — `split` and `sequence` both register `teardown`, and a single slot
 * meant the second silently replaced the first. A throwing link reintroduced
 * that failure by a different route: everything registered after it stopped
 * running, so `destroy()` left a split paragraph in pieces and a sequence
 * holding its decoded frames.
 *
 * `prepare` was worse. The exception left `init()` with no element adopted, and
 * `split` had already rewritten the DOM — a page with split text and no
 * animation on it at all.
 *
 * All three inserts below are registered at module scope, because that is the
 * shape of the real problem: a page wires a third-party module and the
 * library's own modules alongside it.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

let thrown = 0;
/** Registered *before* split, so a chain that stops on a throw never reaches it. */
wireMotion({ on: 'teardown', fn: () => { thrown++; throw new Error('third-party teardown'); } });
wireMotion({ on: 'prepare', fn: () => { thrown++; throw new Error('third-party prepare'); } });
wireMotion(split);

let warnings;
beforeEach(() => {
  thrown = 0;
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
  document.body.innerHTML =
    '<p id="p" data-vera-motion data-vera-motion-split="words" ' +
    'data-vera-motion-opacity="0% 0, 100% 1">alpha beta gamma</p>' +
    '<div id="d" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
});
afterEach(() => vi.restoreAllMocks());

const start = () => {
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

describe('a wired module that throws', () => {
  /**
   * Once per instance, not once per element. The flag used to be page-lifetime
   * — spent by whichever test threw first, so no test after it could observe
   * anything — and became per instance when the chain runner moved inside
   * `createMotion` to reach the diagnostics list. Per instance is the more
   * useful of the two: a page that rebuilds its instance after wiring a fix
   * hears whether the fix worked.
   */
  it('says so once for the instance, not once per element', () => {
    const m = start();
    m.destroy();
    const said = warnings.filter((w) => w.includes('threw in'));
    expect(said).toHaveLength(1);
    /** Both points threw, and several elements were released; still one line. */
    expect(thrown).toBeGreaterThan(1);
    expect(said[0]).toMatch(/threw in (prepare|teardown)/);
  });

  /**
   * And in `rejected`, which was the half missing entirely. A module that
   * throws in `prepare` leaves the page unsplit, undrawn or unprepared, and
   * the list the README sends people to said nothing — the console being the
   * one place the GUI this library exists for cannot look.
   */
  it('records it against the instance, not only the console', () => {
    const m = start();
    const config = m.rejected.filter((entry) => entry.node === null);
    expect(config).toHaveLength(1);
    expect(config[0].rejected[0]).toMatch(/a wired module threw in (prepare|teardown)/);
    m.destroy();
  });

  /** Per instance, so a second one reports for itself rather than inheriting silence. */
  it('and a second instance reports for itself', () => {
    const first = start();
    expect(first.rejected.some((entry) => entry.node === null)).toBe(true);
    first.destroy();
    const second = start();
    expect(second.rejected.some((entry) => entry.node === null)).toBe(true);
    second.destroy();
  });

  it('does not stop init(), and the rest of the prepare chain still runs', () => {
    let m;
    expect(() => { m = start(); }).not.toThrow();
    expect(thrown).toBeGreaterThan(0);
    /** split is registered after the thrower, so its pieces prove the chain continued. */
    expect(document.querySelectorAll('#p span[aria-hidden]').length).toBe(3);
    m.destroy();
  });

  it('and the instance still adopts its elements', () => {
    const m = start();
    expect(m.elements.length).toBeGreaterThan(0);
    expect(m.enabled).toBe(true);
    m.destroy();
  });

  it('does not stop destroy(), and the rest of the teardown chain still runs', () => {
    const m = start();
    expect(document.querySelectorAll('#p span[aria-hidden]').length).toBe(3);
    expect(() => m.destroy()).not.toThrow();
    /** The whole point: split's teardown ran, so the paragraph is whole again. */
    expect(document.querySelectorAll('#p span[aria-hidden]').length).toBe(0);
    expect(document.getElementById('p').textContent).toBe('alpha beta gamma');
  });
});
