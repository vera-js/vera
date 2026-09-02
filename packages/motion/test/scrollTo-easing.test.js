/**
 * An easing name the library does not have.
 *
 * `easings[name] ?? easings[FALLBACK_EASING]` produced a working animation with
 * the wrong curve and nothing to search for — a typo, or a name borrowed from
 * another library's vocabulary, looked exactly like a deliberate choice. A bad
 * `selector` has been reported since the diagnostics work; this is the same
 * kind of mistake in the same options object.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let warnings;
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
  document.body.innerHTML = '<nav><a href="#one">one</a></nav><section id="one"></section>';
});
afterEach(() => vi.restoreAllMocks());

describe('an unknown easing name', () => {
  it('is reported at init, not on the first click', () => {
    const s = createScrollTo({ easing: 'easeOutQuintic' });
    s.init();
    expect(s.rejected).toEqual([
      {
        node: null,
        reason:
          'easing "easeOutQuintic" is not a continuous timing function — use a keyword or ' +
          'cubic-bezier(); using ease-in-out',
      },
    ]);
    s.destroy();
  });

  it('warns as well, so it is visible without reading the instance', () => {
    const s = createScrollTo({ easing: 'nope' });
    s.init();
    expect(warnings.filter((w) => w.includes('not a continuous timing function'))).toHaveLength(1);
    s.destroy();
  });

  /** `node: null` is the documented shape for a problem with the configuration itself. */
  it('carries no node, because no link is at fault', () => {
    const s = createScrollTo({ easing: 'nope' });
    s.init();
    expect(s.rejected[0].node).toBeNull();
    s.destroy();
  });

  it('still animates, using the fallback', () => {
    const s = createScrollTo({ easing: 'nope' });
    s.init();
    expect(() => s.toPosition(0)).not.toThrow();
    s.destroy();
  });
});

describe('steps(), refused on purpose', () => {
  /**
   * A stepped scroll tween teleports in chunks — the opposite of smooth scrolling — and leaving
   * it out keeps the whole steps implementation out of this bundle (187 B gzipped, measured).
   * The animation entry's `ease` still takes it, where holding at a keyframe is meaningful.
   */
  it('reports it like any other unusable easing', () => {
    const s = createScrollTo({ easing: 'steps(4)' });
    s.init();
    expect(s.rejected.map((p) => p.reason).join(' ')).toContain('not a continuous timing function');
    s.destroy();
  });
});

describe('a name the library does have', () => {
  it('says nothing', () => {
    const s = createScrollTo({ easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    s.init();
    expect(s.rejected).toEqual([]);
    expect(warnings).toEqual([]);
    s.destroy();
  });

  it('and neither does the default', () => {
    const s = createScrollTo();
    s.init();
    expect(s.rejected).toEqual([]);
    s.destroy();
  });
});
