import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';
import { createScrollTo } from '../src/scroll-to.ts';

/**
 * The options that went through nothing.
 *
 * `ease`, `inertiaEase`, `inertia`, `transformOrigin`, `onProgress`
 * and `scrollElement` are all checked, and each was checked because the same
 * mistake broke the feature it configures. Three were missed:
 *
 *   - `breakpoints`, whose entries were destructured as `[min, max]` without
 *     asking whether they were pairs — so a number where a pair belonged threw
 *     `not iterable` out of `createMotion` and took the page with it, and a
 *     reversed or non-numeric pair registered a name no width can match.
 *   - `scrollDirection`, where anything that is not `'horizontal'` was read as
 *     vertical, so a typo animated the wrong axis in silence.
 *   - scroll-to's `offset` and `activeThreshold`, which feed arithmetic with no
 *     other guard: a `NaN` offset makes every destination `NaN`, and a `NaN`
 *     threshold makes no link the active one.
 */
const P = 'data-vera-motion';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const start = (options) => {
  document.body.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
  const m = createMotion({ respectReducedMotion: false, inertia: 0, ...options });
  m.init();
  return m;
};
const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected);

describe('the breakpoints table', () => {
  it('does not throw out of the factory on an entry that is not a pair', () => {
    let m;
    expect(() => { m = start({ breakpoints: { mobile: 640 } }); }).not.toThrow();
    expect(reasons(m)).toContain('breakpoint "mobile" is not a usable [min, max]; ignoring it.');
    m.destroy();
  });

  it('reports a reversed range rather than registering an impossible name', () => {
    const m = start({ breakpoints: { mobile: [900, 100] } });
    expect(reasons(m)).toContain('breakpoint "mobile" is not a usable [min, max]; ignoring it.');
    m.destroy();
  });

  it('and a non-numeric one', () => {
    const m = start({ breakpoints: { mobile: ['a', 'b'] } });
    expect(reasons(m)).toContain('breakpoint "mobile" is not a usable [min, max]; ignoring it.');
    m.destroy();
  });

  /** One bad entry, not the whole map: the other names still work. */
  it('drops only the entry that is wrong', () => {
    document.body.innerHTML =
      `<div ${P} ${P}-opacity-good="0% 0, 100% 1" ${P}-opacity-bad="0% 0, 100% 1"></div>`;
    const m = createMotion({
      respectReducedMotion: false, inertia: 0,
      breakpoints: { good: [0, 640], bad: [900, 100] },
    });
    m.init();
    const all = reasons(m).join('\n');
    expect(all).toContain('breakpoint "bad"');
    expect(all).not.toContain('breakpoint "good"');
    /** And the attribute naming the dropped one is now an unknown attribute. */
    expect(all).toContain(`${P}-opacity-bad`);
    expect(all).not.toContain(`${P}-opacity-good`);
    m.destroy();
  });

  it('accepts an open end and a null table', () => {
    const wide = start({ breakpoints: { wide: [900, null] } });
    expect(reasons(wide)).toEqual([]);
    wide.destroy();
    const none = start({ breakpoints: null });
    expect(reasons(none)).toEqual([]);
    none.destroy();
  });
});

describe('scrollDirection', () => {
  it('reports anything that is not one of the two and uses vertical', () => {
    const m = start({ scrollDirection: 'diagonal' });
    expect(reasons(m)).toContain(
      'scrollDirection "diagonal" is not \'vertical\' or \'horizontal\'; using vertical.'
    );
    m.destroy();
  });

  it('says nothing about the two that are', () => {
    for (const direction of ['vertical', 'horizontal']) {
      const m = start({ scrollDirection: direction });
      expect(reasons(m)).toEqual([]);
      m.destroy();
    }
  });
});

/** `NaN` renders as `null` through JSON.stringify, which names a value nobody wrote. */
describe('a NaN option', () => {
  it('is reported as NaN, not as null', () => {
    const m = start({ inertia: NaN });
    expect(reasons(m)).toContain('inertia NaN is not usable; using 0.1.');
    m.destroy();
  });

  it('and a string option keeps its quotes', () => {
    const m = start({ ease: 'wobble' });
    expect(reasons(m).join('\n')).toContain('ease "wobble" is not usable');
    m.destroy();
  });
});

describe("scroll-to's numeric options", () => {
  const links = () => { document.body.innerHTML = '<a id="l" href="#s">l</a><div id="s"></div>'; };

  it('reports an offset that is not a number', () => {
    links();
    const s = createScrollTo({ duration: 0, offset: NaN });
    s.init();
    expect(s.rejected.map((r) => r.reason)).toContain('offset NaN is not a number; using 0');
    s.destroy();
  });

  it('and a threshold that is not', () => {
    links();
    const s = createScrollTo({ duration: 0, activeThreshold: Number.parseInt('half', 10) });
    s.init();
    expect(s.rejected.map((r) => r.reason))
      .toContain('activeThreshold NaN is not a number; using 0.5');
    s.destroy();
  });

  /**
   * Held across `collect()`, which empties the list: a bad option is a property
   * of the instance, not of the markup it happens to be looking at.
   */
  it('and keeps saying so after a re-scan', () => {
    links();
    const s = createScrollTo({ duration: 0, offset: NaN });
    s.init();
    s.collect();
    expect(s.rejected.map((r) => r.reason)).toContain('offset NaN is not a number; using 0');
    s.destroy();
  });

  it('says nothing about numbers', () => {
    links();
    const s = createScrollTo({ duration: 0, offset: 30, activeThreshold: 0.25 });
    s.init();
    expect(s.rejected).toEqual([]);
    s.destroy();
  });
});
