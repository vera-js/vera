/**
 * Instance options, checked the way the attributes carrying them are.
 *
 * An attribute goes through the schema — `inertia-ease` is validated by
 * `parseEasing`, `inertia` is range-checked — and the option of the same name
 * went through nothing. That asymmetry did not merely go unreported, it broke
 * the feature: `inertiaEase: 'wobble'` builds `transition: transform 0.3s
 * wobble`, which the CSSOM refuses outright, so the inline transition stays
 * empty and inertia does nothing at all. Measured in Chromium — computed
 * `transitionDuration` of `0s` where a working instance has `0.3s`.
 *
 * **happy-dom accepts the invalid declaration**, so the breakage is invisible
 * here; what these assert is the fallback, which is the fix. The browser half
 * lives in the harness measurements recorded in the commit.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const DEFAULT_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)';
let warnings;

const place = (node) => {
  Object.defineProperty(node, 'offsetTop', { value: 100, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const build = (options) => {
  document.body.innerHTML =
    '<div data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>';
  const node = document.body.firstElementChild;
  place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0.3, ...options });
  m.init();
  return { node, m };
};

beforeEach(() => {
  warnings = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('an easing option the library does not accept', () => {
  it('falls back to the default rather than writing it into the transition', () => {
    const { node, m } = build({ inertiaEase: 'wobble' });
    expect(node.style.transition).toContain(DEFAULT_EASE);
    expect(node.style.transition).not.toContain('wobble');
    m.destroy();
  });

  it('says so once', () => {
    const { m } = build({ inertiaEase: 'wobble' });
    expect(warnings.filter((w) => w.includes('inertiaEase'))).toHaveLength(1);
    m.destroy();
  });

  it('checks ease the same way', () => {
    const { m } = build({ ease: 'wobble' });
    expect(warnings.filter((w) => w.includes('ease "wobble"'))).toHaveLength(1);
    m.destroy();
  });
});

describe('a numeric option that is not a number', () => {
  /** `parseInt` of a config string is where this comes from, every time. */
  it('falls back to the default inertia', () => {
    const { node, m } = build({ inertia: Number.parseInt('slow', 10) });
    expect(node.style.transition).toContain('0.1s');
    m.destroy();
  });

  it('and the default inertia', () => {
    const { m } = build({ inertia: NaN });
    expect(warnings.filter((w) => w.includes('inertia '))).toHaveLength(1);
    m.destroy();
  });
});

describe('onProgress that is not a function', () => {
  /**
   * The one option whose value is *invoked* rather than read.
   * `settings.onProgress?.(node, progress)` guards against absent, not against
   * present-and-not-callable — so this threw out of `init()` and took the whole
   * instance with it. Everything else here degrades; this one broke.
   */
  it('does not take the instance down with it', () => {
    expect(() => build({ onProgress: 'yes' })).not.toThrow();
  });

  it('leaves the element animating', () => {
    const { node, m } = build({ onProgress: 'yes' });
    expect(node.style.transform).toContain('translateY');
    m.destroy();
  });

  it('and says so', () => {
    const { m } = build({ onProgress: 'yes' });
    expect(warnings.filter((w) => w.includes('onProgress'))).toHaveLength(1);
    m.destroy();
  });

  it('while a real callback still runs', () => {
    const seen = [];
    const { m } = build({ onProgress: (node, progress) => seen.push(progress) });
    expect(seen.length).toBeGreaterThan(0);
    expect(warnings).toEqual([]);
    m.destroy();
  });

  /** Absent is not a mistake, and must stay silent. */
  it('and leaving it out says nothing', () => {
    const { m } = build({});
    expect(warnings.filter((w) => w.includes('onProgress'))).toEqual([]);
    m.destroy();
  });
});

describe('transformOrigin', () => {
  /**
   * Only the fallback is assertable here. happy-dom's `CSS.supports` returns
   * `true` for anything, so the *detection* cannot be exercised outside a
   * browser — measured in Chromium instead: an invalid origin leaves the
   * computed value at the element's centre, with one warning.
   */
  it('passes a usable value through', () => {
    const { m } = build({ transformOrigin: 'top left' });
    expect(warnings.filter((w) => w.includes('transformOrigin'))).toEqual([]);
    m.destroy();
  });

  it('says nothing when it is not set', () => {
    const { m } = build({});
    expect(warnings.filter((w) => w.includes('transformOrigin'))).toEqual([]);
    m.destroy();
  });
});

describe('options the library does accept', () => {
  /**
   * `ease` stays `linear` here on purpose. Any other value is valid *and*
   * requires `@verajs/motion/easings`, which this file does not wire — so it
   * warns about the missing module, which is a different and correct warning
   * that has nothing to do with validation. `inertiaEase` carries the
   * non-default case instead: it is handed to CSS and needs no module.
   */
  it('pass through untouched and say nothing', () => {
    const { node, m } = build({ inertia: 0.4, inertiaEase: 'ease-in-out', ease: 'linear' });
    expect(node.style.transition).toContain('0.4s');
    expect(node.style.transition).toContain('ease-in-out');
    expect(warnings).toEqual([]);
    m.destroy();
  });

  it('including the defaults', () => {
    const { m } = build({});
    expect(warnings).toEqual([]);
    m.destroy();
  });
});
