import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * `translateZ()` needs a perspective to project through. Without one it is
 * measured to do **nothing at all** — a 100x100 box stays 100x100 at
 * `translateZ(200px)` and doubles with a perspective — and
 * `docs/ATTRIBUTE-REFERENCE.md` has stated exactly that, as measured fact, for
 * as long as the attribute has existed.
 *
 * The runtime accepted it in silence anyway, which is the worst of the two: the
 * reference tells an author the attribute does nothing and the library lets
 * them write it. Reported at measure time, beside `pinBlocked`, because the
 * answer depends on an ancestor's computed style and that changes under the
 * page.
 *
 * happy-dom has no layout and no cascade, so what is tested here is the
 * decision. `getComputedStyle` does return an inline `perspective`, which is
 * enough for every branch below.
 */
const P = 'data-vera-motion';

const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected).join('\n');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const build = (attrs, wrapperStyle = '') => {
  document.body.innerHTML =
    `<div id="wrap"${wrapperStyle ? ` style="${wrapperStyle}"` : ''}>` +
    `<div id="t" ${P} ${attrs}></div></div>`;
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

const FLAT = `${P}-translate-z="0% 0px, 100% 200px"`;

describe('translate-z with nothing to project through', () => {
  it('is reported', () => {
    const m = build(FLAT);
    expect(reasons(m)).toContain('does nothing without a perspective');
    m.destroy();
  });

  it('and names both ways to fix it', () => {
    const m = build(FLAT);
    expect(reasons(m)).toContain(`${P}-perspective`);
    expect(reasons(m)).toContain('CSS `perspective`');
    m.destroy();
  });

  it('says nothing when the element carries its own perspective', () => {
    const m = build(`${FLAT} ${P}-perspective="800px"`);
    expect(reasons(m)).not.toContain('does nothing without a perspective');
    m.destroy();
  });

  /**
   * The older, plainer way to set one up, and a page using it is not making a
   * mistake. Any ancestor carrying a perspective ends the walk without a word.
   */
  it('says nothing when an ancestor sets a CSS perspective', () => {
    const m = build(FLAT, 'perspective: 800px');
    expect(reasons(m)).not.toContain('does nothing without a perspective');
    m.destroy();
  });

  /** And it is about `translate-z` alone — the other 3D properties work flat. */
  it('says nothing about rotate-x, which reads as squashing rather than nothing', () => {
    const m = build(`${P}-rotate-x="0% 0deg, 100% 45deg"`);
    expect(reasons(m)).not.toContain('does nothing without a perspective');
    m.destroy();
  });

  /**
   * Re-derived on every measure, like `pinBlocked`: an ancestor's `perspective`
   * can be added or removed after init, and a diagnostic that answered once is
   * wrong from then on.
   */
  it('and clears when a perspective appears on an ancestor', () => {
    const m = build(FLAT);
    expect(reasons(m)).toContain('does nothing without a perspective');
    document.getElementById('wrap').style.perspective = '800px';
    m.refresh();
    expect(reasons(m)).not.toContain('does nothing without a perspective');
    m.destroy();
  });
});
