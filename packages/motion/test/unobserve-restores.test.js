import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

/**
 * `unobserve` means "this root is no longer mine", so it has to hand the root
 * back the way `destroy()` hands the page back.
 *
 * It released every node carrying the bare `data-vera-motion` marker, and a
 * module's own bookkeeping is not attribute-shaped. `split` is keyed by the
 * **container**, whose marker is optional — splitting keys off
 * `data-vera-motion-split`, and the animation attributes move to the pieces —
 * so a container written without it was missed. Having been dropped from
 * `roots` it was then missed by `destroy()` too, and the paragraph stayed in
 * three pieces for the life of the page with no instance left that could
 * restore it.
 */
const scoped = (markup) => {
  document.body.innerHTML = `<div id="scope">${markup}</div>`;
  const scope = document.getElementById('scope');
  const m = createMotion({ respectReducedMotion: false, inertia: 0, root: scope });
  m.init();
  return { m, scope };
};

const MARKED = '<p data-vera-motion data-vera-motion-split="words" ' +
  'data-vera-motion-opacity="0% 0, 100% 1">one two three</p>';
const BARE = '<p data-vera-motion-split="words" ' +
  'data-vera-motion-opacity="0% 0, 100% 1">one two three</p>';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'scrollY', { value: 3000, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 12000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('unobserving a root gives it back', () => {
  it('puts a split container back together', () => {
    const { m, scope } = scoped(MARKED);
    expect(scope.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    m.unobserve(scope);
    expect(scope.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(scope.querySelector('p').textContent).toBe('one two three');
    m.destroy();
  });

  /** The case the per-element pass cannot reach, and nothing could recover from. */
  it('including a container written without the bare marker', () => {
    const { m, scope } = scoped(BARE);
    expect(scope.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    m.unobserve(scope);
    expect(scope.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(scope.querySelector('p').textContent).toBe('one two three');
    m.destroy();
  });

  it('and destroy after an unobserve leaves nothing behind either', () => {
    const { m, scope } = scoped(BARE);
    m.unobserve(scope);
    m.destroy();
    expect(scope.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(scope.querySelector('p').textContent).toBe('one two three');
  });

  /**
   * Scoped to the root, not the instance: another root the instance still owns
   * keeps its pieces, or `unobserve` would be `destroy` with extra steps.
   */
  it('leaves a root it still owns alone', () => {
    document.body.innerHTML = `<div id="a">${BARE}</div><div id="b">${BARE}</div>`;
    const a = document.getElementById('a');
    const b = document.getElementById('b');
    const m = createMotion({ respectReducedMotion: false, inertia: 0, root: a });
    m.init();
    m.observe(b);
    expect(b.querySelectorAll('span[aria-hidden]')).toHaveLength(3);

    m.unobserve(b);
    expect(b.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(a.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    m.destroy();
    expect(a.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
  });
});

/**
 * `release` is a public insert point, and a module is free to register it and
 * nothing else — a module that only holds state keyed by a node has no page to
 * put back and needs no `teardown`. Both wired modules here register both, so
 * the `teardown` call in `unobserve` covers everything they hold; this module
 * is what makes the `release` half of that path observable at all.
 *
 * Where it stops is the second test. `unobserve` used to cast a wider net than
 * `clear()` — a `querySelectorAll` for the bare marker, so a release-only
 * module heard about a *marked but unadopted* node when a root was handed back
 * and never heard about the same node on `destroy()`. The contract is "one
 * element is leaving", and a node the instance never adopted never arrived, so
 * the two paths agree on adopted elements and neither reaches past them.
 * Anything page-shaped is `teardown`'s, which is scoped by root and not by
 * attribute.
 */
describe('a module that registers only release', () => {
  const released = [];
  /**
   * A whole property, not a stub. The first version of this declared
   * `{ attribute: 'nudge', type: 'length', units: ['px'], apply: () => '' }`,
   * which is not a property descriptor — no `parse`, no `cssProperty`, no
   * `initial` — so the attribute was **refused** and the element was never
   * adopted. The test passed anyway, because the marker net released marked
   * nodes whether or not the runtime had adopted them, and so it asserted the
   * net rather than the release-only module it names.
   */
  wireMotion([
    { on: 'release', fn: (node) => released.push(node.tagName) },
    {
      attribute: 'nudge',
      category: 'border',
      cssProperty: 'outline-offset',
      defaultUnit: 'px',
      units: ['px'],
      initial: 0,
      parse: (raw) => parseFloat(raw),
      apply: (node, value) => node.style.setProperty('outline-offset', `${value}px`),
    },
  ]);

  const scopedNudge = (id, markup) => {
    document.body.innerHTML = `<div id="${id}">${markup}</div>`;
    const scope = document.getElementById(id);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, root: scope });
    m.init();
    /** The premise the old version lost: it has to have been adopted. */
    expect(m.rejected).toEqual([]);
    expect(m.elements.length).toBe(1);
    return { m, scope };
  };

  const ANIMATED = '<p data-vera-motion data-vera-motion-nudge="0% 0px, 100% 10px">one</p>';

  it('still hears about a root being handed back', () => {
    const { m, scope } = scopedNudge('scope', ANIMATED);
    released.length = 0;
    m.unobserve(scope);
    expect(released).toContain('P');
    m.destroy();
  });

  /**
   * The parity the net broke: a marked container with nothing animated on it is
   * not an element, so neither path releases it. Assert both, together — the
   * asymmetry was invisible precisely because no test asked the same question
   * of both paths.
   */
  it('and hears about the same nodes on unobserve as on destroy', () => {
    const markup = '<p id="idle" data-vera-motion>nothing animated here</p>' + ANIMATED;

    document.body.innerHTML = `<div id="one">${markup}</div>`;
    const one = document.getElementById('one');
    const a = createMotion({ respectReducedMotion: false, inertia: 0, root: one });
    a.init();
    released.length = 0;
    a.unobserve(one);
    const byUnobserve = [...released];
    a.destroy();

    document.body.innerHTML = `<div id="two">${markup}</div>`;
    const two = document.getElementById('two');
    const b = createMotion({ respectReducedMotion: false, inertia: 0, root: two });
    b.init();
    released.length = 0;
    b.destroy();

    expect(byUnobserve).toEqual(released);
    expect(byUnobserve).toEqual(['P']);
  });
});
