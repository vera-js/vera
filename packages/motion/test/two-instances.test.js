import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * Two live instances animating one element.
 *
 * Both adopt it, both write its style every frame, and `destroy()` on either
 * strips what the other owns — silently, with an empty `rejected` on both.
 * `CLAUDE.md` has called the configuration unsupported, which is not the same
 * as detected, and the README a consumer reads never mentioned it at all. Two
 * plugins on one WordPress page each calling `createMotion()` is how it
 * happens, and that page is this library's stated consumer.
 *
 * **Per element, not per root.** A root-overlap test at `init()` would accuse
 * two instances that share a document and no elements — which is most of this
 * repository's own tests and none of the bug. Measured before choosing: 71 of
 * 109 test files build more than one instance, and the per-element form makes
 * no noise in any of them.
 *
 * The false accusation this could produce is the reason for half the tests
 * below: a claim not released leaves an `init()` / `destroy()` / `init()`
 * accusing itself, which it did until `destroy()` learned to drop them.
 *
 * The claim goes to the **latest** adopter, and the second block below is why.
 */
const P = 'data-vera-motion';

const page = () => {
  document.body.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  return node;
};

const start = () => {
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

const said = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');
const FOUGHT = 'already animating this element';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a second instance animating the same element', () => {
  it('is reported', () => {
    page();
    const a = start();
    const b = start();
    expect(said(b)).toContain(FOUGHT);
    a.destroy();
    b.destroy();
  });

  /**
   * On **both**, which falls out of the reasons living in one page-level
   * registry that every instance merges at read time. Whoever renders either
   * list sees it, and in the two-plugins case there is no telling which one
   * that will be.
   */
  it('and on the instance that was there first', () => {
    page();
    const a = start();
    const b = start();
    expect(said(a)).toContain(FOUGHT);
    a.destroy();
    b.destroy();
  });

  it('and names both ways out', () => {
    page();
    const a = start();
    const b = start();
    expect(said(b)).toContain('Use one instance, or give each its own root');
    a.destroy();
    b.destroy();
  });
});

/**
 * The claim goes to the **latest** adopter, not the first.
 *
 * Keeping the first looks equivalent and under-reports by one step, in the
 * order a page actually tears down: A and B both animate an element, B is told,
 * A is destroyed. B is still animating and holds nothing, so a third instance
 * arriving after that hears nothing — the silence this check exists to end.
 *
 * The mutation runner found it. `a claim is dropped on any instance, not only
 * its owner` survived, and the reason it could not be caught was that the
 * claim's *owner* stopped mattering once the first instance left.
 */
describe('when instances leave in the order a page tears them down', () => {
  it('still warns a third instance while a second is animating', () => {
    page();
    const a = start();
    const b = start();
    expect(said(b)).toContain(FOUGHT);
    a.destroy();

    const c = start();
    expect(said(c), 'b is still animating this element').toContain(FOUGHT);
    b.destroy();
    c.destroy();
  });

  /** And once the last of them goes, the element is free again. */
  it('and says nothing once every earlier instance is gone', () => {
    page();
    const a = start();
    const b = start();
    a.destroy();
    b.destroy();

    const c = start();
    expect(said(c)).toBe('');
    c.destroy();
  });
});

describe('and the ways it must stay quiet', () => {
  /** The false accusation the claim-release exists to prevent. */
  it('says nothing when the first instance is destroyed before the second', () => {
    page();
    const a = start();
    a.destroy();
    const b = start();
    expect(said(b)).toBe('');
    b.destroy();
  });

  /**
   * `disable()` clears styles and keeps `elements`, re-styling them on the way
   * back without re-adopting — so the claim must survive it. Releasing on
   * `clear()` would have been the obvious place and the wrong one: the claim
   * would never be taken again.
   */
  it('says nothing across a disable and enable', () => {
    page();
    const m = start();
    m.disable();
    m.enable();
    expect(said(m)).toBe('');
    m.destroy();
  });

  /** `collect()` drops and re-adopts every changed element by design. */
  it('says nothing when the same instance re-collects', () => {
    page();
    const m = start();
    m.collect();
    m.collect();
    expect(said(m)).toBe('');
    m.destroy();
  });

  /**
   * The configuration `observe(shadowRoot)` exists for: disjoint roots, which
   * is supported and common. Nothing is shared, so nothing is said.
   */
  it('says nothing for two instances with disjoint roots', () => {
    document.body.innerHTML =
      `<div id="one"><p ${P} ${P}-opacity="0% 0, 100% 1"></p></div>` +
      `<div id="two"><p ${P} ${P}-opacity="0% 0, 100% 1"></p></div>`;
    const a = createMotion({ respectReducedMotion: false, inertia: 0, root: document.getElementById('one') });
    const b = createMotion({ respectReducedMotion: false, inertia: 0, root: document.getElementById('two') });
    a.init();
    b.init();
    expect(said(a)).toBe('');
    expect(said(b)).toBe('');
    a.destroy();
    b.destroy();
  });
});
