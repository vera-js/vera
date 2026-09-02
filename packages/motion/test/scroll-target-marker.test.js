import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';
import { createScrollTo } from '../src/scroll-to.ts';
import { SCROLL_TARGET_ATTRIBUTE } from '../src/modules/namespace.ts';

/**
 * The two entry points share a namespace and do not import each other, so a
 * name only one of them knew was a name the other reported as a stranger.
 *
 * `scroll-to` marks every element one of its links points at. `parse.ts`
 * refuses anything prefixed with the namespace that is not a registered
 * setting — right for an attribute an author wrote, wrong for one this library
 * wrote itself. Every animated scroll-to target carried a spurious
 * unknown-attribute refusal, on a page using both entry points, which is the
 * intended combination.
 *
 * Found by `spikes/fixture-diagnostics.mjs` the day after it was written: the
 * sticky fixture gained a nav, and the check said the page was refusing
 * something it had not declared.
 */
const P = 'data-vm';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('an element that is both animated and a scroll-to target', () => {
  it('is not accused of carrying an unknown attribute', () => {
    document.body.innerHTML =
      '<a id="l" href="#s">go</a>' +
      `<div id="s" ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    const to = createScrollTo({ duration: 0 });
    to.init();
    /** The marker is on now, which is the condition. */
    expect(document.getElementById('s').hasAttribute(SCROLL_TARGET_ATTRIBUTE)).toBe(true);

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.rejected).toEqual([]);

    m.destroy();
    to.destroy();
  });

  /** And a genuinely unknown attribute is still a stranger. */
  it('while a real typo is still reported', () => {
    document.body.innerHTML =
      `<div id="s" ${P} ${P}-opactiy="0% 0, 100% 1" ${P}-opacity="0% 0, 100% 1"></div>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const said = m.rejected.flatMap((entry) => entry.rejected);
    expect(said).toHaveLength(1);
    expect(said[0].startsWith(`${P}-opactiy: `)).toBe(true);
    expect(said[0]).toMatch(/no such attribute/);
    m.destroy();
  });

  /** One definition: what scroll-to writes is what parse excuses. */
  it('uses one name for both halves', () => {
    document.body.innerHTML = '<a id="l" href="#s">go</a><div id="s"></div>';
    const to = createScrollTo({ duration: 0 });
    to.init();
    const marked = document.getElementById('s').getAttributeNames()
      .filter((name) => name.startsWith(`${P}-`));
    expect(marked).toEqual([SCROLL_TARGET_ATTRIBUTE]);
    to.destroy();
  });
});
