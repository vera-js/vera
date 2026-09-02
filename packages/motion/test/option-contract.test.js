import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { sequence } from '../src/sequence.ts';
import { easings } from '../src/easings.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';

wireMotion(sequence);

const place = (n, top = 500) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const build = (html, options) => {
  document.body.innerHTML = html;
  const node = document.body.firstElementChild;
  place(node);
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const m = createMotion({ respectReducedMotion: false, ...options });
  m.init();
  return { node, m };
};
const TY = '<div data-vm data-vm-translate-y="0% 0px, 100% 60px"></div>';

beforeEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

wireMotion(easings);

describe('every documented option does what it says', () => {
  /**
   * These two were the gap. This file is named for covering every documented
   * option and did not touch either — and `scrollDirection` is where the audit
   * later found three separate defects: the visibility tracker's root margin,
   * `pin`'s sticky edge, and `scroll-to` zeroing the axis it was not tweening.
   */
  it('scrollDirection — horizontal measures and pins along the horizontal axis', () => {
    document.body.innerHTML =
      '<div data-vm data-vm-pin="20px" ' +
      'data-vm-translate-x="0% 0px, 100% 60px"></div>';
    const node = document.body.firstElementChild;
    for (const [k, v] of [['offsetLeft', 500], ['offsetTop', 500], ['offsetWidth', 200], ['offsetHeight', 200]]) {
      Object.defineProperty(node, k, { value: v, configurable: true });
    }
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
    Object.defineProperty(window, 'scrollX', { value: 5000, configurable: true });

    const m = createMotion({ respectReducedMotion: false, inertia: 0, scrollDirection: 'horizontal' });
    m.init();
    m.refresh();

    /** Driven by horizontal scroll, so it has reached the end of its timeline. */
    expect(node.style.transform).toBe('translateX(60px)');
    /** And pinned against the leading edge on that axis — the logical one, so RTL resolves itself. */
    expect(node.style.getPropertyValue('inset-inline-start')).toBe('20px');
    expect(node.style.top).toBe('');
    m.destroy();
    Object.defineProperty(window, 'scrollX', { value: 0, configurable: true });
  });

  it('scrollElement — the timeline follows that container, not the window', () => {
    document.body.innerHTML =
      '<div id="pane"><div data-vm ' +
      'data-vm-translate-y="0% 0px, 100% 60px"></div></div>';
    const pane = document.getElementById('pane');
    const node = pane.firstElementChild;
    /**
     * The pane sits 300px down the document, and that offset has to come back
     * off: the element's position is measured in document coordinates while
     * the scroll position is read from the container. With an offset of 0 this
     * test cannot tell the difference — which it could not, at first.
     */
    for (const [k, v] of [['offsetTop', 300], ['offsetHeight', 400], ['clientHeight', 400]]) {
      Object.defineProperty(pane, k, { value: v, configurable: true });
    }
    Object.defineProperty(pane, 'offsetParent', { value: null, configurable: true });
    place(node, 1000);

    const m = createMotion({ respectReducedMotion: false, inertia: 0, scrollElement: pane });
    m.init();

    /** The window has not moved; only the pane has. */
    const before = node.style.transform;
    pane.scrollTop = 900;
    m.refresh();
    expect(node.style.transform).not.toBe(before);
    /** Measured against the pane: 900 is the end of this element's timeline. */
    expect(node.style.transform).toBe('translateY(60px)');

    /** And moving the window instead does nothing. */
    const after = node.style.transform;
    Object.defineProperty(window, 'scrollY', { value: 9000, configurable: true });
    m.refresh();
    expect(node.style.transform).toBe(after);
    m.destroy();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('inertia — seconds of catch-up; 0 means no transition', () => {
    const a = build(TY, { inertia: 0.45 });
    expect(a.node.style.transition).toContain('0.45s');
    a.m.destroy();
    const b = build(TY, { inertia: 0 });
    expect(b.node.style.transition).toBe('');
    b.m.destroy();
  });

  it('inertiaEase — the timing function of that catch-up', () => {
    const { node, m } = build(TY, { inertia: 0.2, inertiaEase: 'ease-in-out' });
    expect(node.style.transition).toContain('ease-in-out');
    m.destroy();
  });

  it('ease — shapes value against scroll, not the transition', () => {
    const straight = build(TY, { inertia: 0, ease: 'linear' });
    const midLinear = straight.node.style.transform;
    straight.m.destroy();
    const curved = build(TY, { inertia: 0, ease: 'ease-in' });
    expect(curved.node.style.transform).not.toBe(midLinear);
    expect(curved.node.style.transition).toBe('');
    curved.m.destroy();
  });

  it('willChange — sets will-change when asked, not by default', () => {
    const off = build(TY, {});
    expect(off.node.style.willChange).toBe('');
    off.m.destroy();
    const on = build(TY, { willChange: true });
    /** TY is a translate, so the hint names `transform` and nothing else. */
    expect(on.node.style.willChange).toBe('transform');
    on.m.destroy();
  });

  it('transformOrigin — applied as the default origin', () => {
    const { node, m } = build(TY, { transformOrigin: 'bottom right' });
    expect(node.style.transformOrigin).toBe('bottom right');
    m.destroy();
  });

  it('translateZFix — prefixes transforms to force promotion', () => {
    const { node, m } = build(TY, { translateZFix: true });
    expect(node.style.transform).toContain('translateZ(0px)');
    m.destroy();
  });

  it('breakpoints — names become usable attribute suffixes', () => {
    document.body.innerHTML =
      '<div data-vm data-vm-translate-y="0% 0px, 100% 60px" data-vm-translate-y-phone="0% 0px, 100% 5px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, breakpoints: { phone: [0, 5000] } });
    m.init();
    expect(m.elements[0].plan.all[0].bands).toHaveLength(1);
    expect(m.rejected.flatMap((r) => r.rejected)).toEqual([]);
    m.destroy();
  });

  it('observeMutations — false means later elements are ignored', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const m = createMotion({ respectReducedMotion: false, observeMutations: false });
    m.init();
    document.getElementById('host').innerHTML = TY;
    place(document.querySelector('[data-vm]'));
    await new Promise((r) => setTimeout(r, 30));
    expect(m.elements).toHaveLength(0);
    m.destroy();
  });

  it('root — only elements inside it are animated', () => {
    document.body.innerHTML = `<div id="outside">${TY}</div><div id="scope">${TY}</div>`;
    document.querySelectorAll('[data-vm]').forEach((n) => place(n));
    const m = createMotion({ respectReducedMotion: false, root: document.getElementById('scope') });
    m.init();
    expect(m.elements).toHaveLength(1);
    expect(document.querySelector('#outside [data-vm]').style.transform).toBe('');
    m.destroy();
  });

  it('onProgress — called with (node, progress) as the element updates', () => {
    const calls = [];
    const { node, m } = build(TY, { inertia: 0, onProgress: (n, p) => calls.push([n, p]) });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0]).toBe(node);
    expect(typeof calls[0][1]).toBe('number');
    m.destroy();
  });

  it('respectReducedMotion — honoured when true, overridable when false', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    document.body.innerHTML = TY;
    const node = document.body.firstElementChild;
    place(node);
    const honoured = createMotion({ respectReducedMotion: true });
    honoured.init();
    expect(honoured.reducedMotion).toBe(true);
    expect(node.style.transform).toBe('');
    honoured.destroy();

    const ignored = createMotion({ respectReducedMotion: false });
    ignored.init();
    expect(ignored.reducedMotion).toBe(false);
    expect(node.style.transform).not.toBe('');
    ignored.destroy();
    vi.restoreAllMocks();
  });

  it('disableOnTouch — leaves everything un-animated on a coarse pointer', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({
      matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {},
    }));
    document.body.innerHTML = TY;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, disableOnTouch: true });
    m.init();
    expect(m.touchDisabled).toBe(true);
    expect(node.style.transform).toBe('');
    m.destroy();
    vi.restoreAllMocks();
  });
});

/**
 * An option name this library does not have.
 *
 * Every option *value* was checked and every bad one reported, and the key
 * itself was not — so `createMotion({ intertia: 0.4 })` ran on the default
 * inertia and said nothing at all. One level down, an attribute nobody
 * registered is reported as unknown, on the element, by name; the same mistake
 * one level up was silent.
 *
 * TypeScript catches it, which decides who this is for rather than excusing it:
 * a GUI editor builds these objects server-side, the demo pages are plain JavaScript,
 * and the GUI that would show the answer is the one that cannot read a console.
 */
describe('an option that does not exist', () => {
  const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

  it('is reported by name', () => {
    const m = createMotion({ intertia: 0.4, respectReducedMotion: false });
    m.init();
    expect(reasons(m)).toContain('"intertia", which is not an option');
    m.destroy();
  });

  /** And the instance still runs: an unknown key is a diagnostic, not a failure. */
  it('and does not stop the instance', () => {
    document.body.innerHTML =
      '<div data-vm data-vm-opacity="0% 0, 100% 1"></div>';
    const m = createMotion({ nonsense: true, respectReducedMotion: false });
    m.init();
    expect(m.elements).toHaveLength(1);
    m.destroy();
  });

  it('and every real option is accepted in silence', () => {
    const m = createMotion({
      scrollDirection: 'vertical', scrollElement: window, inertia: 0.2,
      inertiaEase: 'linear', ease: 'linear', breakpoints: {},
      respectReducedMotion: false, willChange: false, translateZFix: false,
      transformOrigin: '', root: document, observeMutations: false,
      disableOnTouch: false, onProgress: () => {},
    });
    m.init();
    expect(reasons(m)).not.toContain('is not an option');
    m.destroy();
  });
});

/**
 * And the other entry point, which had the same gap for the same reason. One
 * GUI generates the objects for both, so a check on one of them is the
 * one-entry-point asymmetry this package keeps removing, pointing the other way.
 */
describe('createScrollTo and an option that does not exist', () => {
  it('reports it by name', async () => {
    const { createScrollTo } = await import('../src/scroll-to.ts');
    const s = createScrollTo({ dration: 500 });
    s.init();
    expect(s.rejected.map((problem) => problem.reason).join(' | '))
      .toContain('"dration" is not an option');
    s.destroy();
  });

  it('and accepts every real one in silence', async () => {
    const { createScrollTo } = await import('../src/scroll-to.ts');
    const s = createScrollTo({
      selector: 'a', duration: 100, easing: 'linear', offset: 0,
      activeClass: 'on', activeThreshold: 0.5, updateHash: false,
      cancelOnUserInput: true, scrollDirection: 'vertical', scrollElement: window,
      respectReducedMotion: false, root: document, manageFocus: false,
    });
    s.init();
    expect(s.rejected.map((problem) => problem.reason).join(' | ')).not.toContain('is not an option');
    s.destroy();
  });
});

/**
 * The one option `scroll-to` still read **as** vertical when it was anything
 * else. `createMotion` has refused it since 2026-08-30 for the reason that
 * applies just as well here — a typo scrolls the wrong axis and there is
 * nothing anywhere to find — and this entry point never did.
 */
describe('createScrollTo and a direction that is neither', () => {
  it('reports it and falls back to vertical', async () => {
    const { createScrollTo } = await import('../src/scroll-to.ts');
    const s = createScrollTo({ scrollDirection: 'sideways' });
    s.init();
    const said = s.rejected.map((problem) => problem.reason).join(' | ');
    expect(said).toContain('scrollDirection');
    expect(said).toContain('using vertical');
    s.destroy();
  });

  it('and says nothing about either real value', async () => {
    const { createScrollTo } = await import('../src/scroll-to.ts');
    for (const direction of ['vertical', 'horizontal']) {
      const s = createScrollTo({ scrollDirection: direction });
      s.init();
      expect(s.rejected.map((problem) => problem.reason).join(' | ')).not.toContain('scrollDirection');
      s.destroy();
    }
  });
});

/**
 * A boolean option that is not a boolean.
 *
 * This library refuses exactly this one level down — `run-once="yes"` used to
 * come out **off** and is reported now — on the argument that being wrong about
 * a boolean is quiet in a way being wrong about a number is not: nothing looks
 * broken, the behaviour is simply inverted. The *option* path never got the
 * same treatment, and it is the one a GUI and a PHP template write into.
 *
 * The direction is the opposite one and worse. An attribute coerced a bad
 * boolean to **off**; an option is a bare truthy test, so every string coerces
 * to **on** — `disableOnTouch: 'no'` turned animation off on every touch
 * device, which is the exact inverse of what was written.
 */
describe('a boolean option that is not a boolean', () => {
  const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

  it('is reported, and the default is used instead of the truthy string', () => {
    const m = createMotion({ respectReducedMotion: false, disableOnTouch: 'no' });
    m.init();
    expect(reasons(m)).toContain('disableOnTouch must be true or false, not "no"');
    m.destroy();
  });

  /**
   * The half that matters: the fallback is applied, not the truthy value.
   * `willChange: 'yes'` would write `will-change` on every element if the
   * string were read as `true`.
   */
  it('and the fallback really takes effect', () => {
    document.body.innerHTML =
      '<div data-vm data-vm-opacity="0% 0, 100% 1"></div>';
    const node = document.body.firstElementChild;
    const m = createMotion({ respectReducedMotion: false, willChange: 'yes' });
    m.init();
    expect(reasons(m)).toContain('willChange must be true or false');
    expect(node.style.willChange, 'the default false, not the truthy string').toBe('');
    m.destroy();
  });

  it('and a real boolean is accepted in silence', () => {
    const m = createMotion({ respectReducedMotion: false, willChange: true, disableOnTouch: false });
    m.init();
    expect(reasons(m)).not.toContain('must be true or false');
    m.destroy();
  });

  /** Both entry points, from each one's own `DEFAULTS` rather than a list. */
  it('and scroll-to does the same', async () => {
    const { createScrollTo } = await import('../src/scroll-to.ts');
    const s = createScrollTo({ manageFocus: 'no' });
    s.init();
    expect(s.rejected.map((problem) => problem.reason).join(' | '))
      .toContain('manageFocus must be true or false, not "no"');
    s.destroy();
  });
});

/**
 * An option present with the value `undefined` means **not given**, not "off".
 *
 * `{ ...DEFAULTS, ...options }` lets an explicit `undefined` win, and for a
 * boolean whose default is `true` that inverts it. `respectReducedMotion:
 * undefined` produced `enabled === true` on a device asking for reduced motion,
 * silently, with an empty `rejected` — the one case in this whole class where
 * being wrong turns an accessibility preference off. The public `reducedMotion`
 * getter, typed `boolean`, returned `undefined` with it.
 *
 * `{ respectReducedMotion: config.respect }` with the key absent from `config`
 * is how generated code is written, which is exactly what a GUI editor emits.
 * `exactOptionalPropertyTypes` makes TypeScript refuse the literal, so this is
 * the JavaScript audience again.
 */
describe('an option given as undefined', () => {
  it('does not turn reduced-motion respect off', () => {
    vi.stubGlobal('matchMedia', (query) => ({
      matches: query.includes('reduce'), media: query,
      addEventListener() {}, removeEventListener() {},
    }));
    const m = createMotion({ respectReducedMotion: undefined });
    m.init();
    expect(m.reducedMotion, 'the default is true, and undefined is not an answer').toBe(true);
    expect(m.enabled).toBe(false);
    m.destroy();
    vi.unstubAllGlobals();
  });

  it('and takes the default for a number', () => {
    const { node, m } = build(
      '<div data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>',
      { inertia: undefined }
    );
    expect(node.style.transition).toContain('0.1s');
    /** And says nothing: `undefined` is how JavaScript spells "unset". */
    expect(m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ')).not.toContain('inertia');
    m.destroy();
  });

  it('and scroll-to keeps its default-true booleans', async () => {
    const { createScrollTo } = await import('../src/scroll-to.ts');
    const s = createScrollTo({ manageFocus: undefined, cancelOnUserInput: undefined });
    s.init();
    expect(s.rejected.map((problem) => problem.reason).join(' | ')).toBe('');
    s.destroy();
  });
});
