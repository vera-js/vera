import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { vi } from './expect.mjs';
/**
 * A minimal paint module, living entirely outside core: it carries its own
 * parser and its own write path. Core never learns what a colour is.
 */
const values = [];
const seen = new Map();

const paint = {
  attribute: 'background',
  category: 'border',
  /** Declared so the runtime routes it and `inertia` puts it in the transition list. */
  cssProperty: 'background',
  defaultUnit: '',
  units: [''],
  initial: 0,
  parse: (raw) => {
    const value = raw.trim();
    /** No url(): an attribute must not reach past the origin policy. */
    if (!value || value.length > 400 || /url\(/i.test(value)) return null;
    let index = seen.get(value);
    if (index === undefined) { index = values.length; values.push(value); seen.set(value, index); }
    return index;
  },
  /** Steps at the keyframe — floor, not round — and CSS transitions the change. */
  apply: (node, value) => {
    const picked = values[Math.floor(value)];
    if (picked !== undefined) node.style.setProperty('background', picked);
  },
};

const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 3000, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

describe('a property module that carries its own parse and apply', () => {
  it('animates background through the module, with no core knowledge of colour', () => {
    wireMotion(paint);
    document.body.innerHTML =
      '<div data-vm data-vm-inertia="0.4" ' +
      'data-vm-background="0% linear-gradient(red, blue), 100% #0a0"></div>';
    const node = document.body.firstElementChild;
    place(node);
    /** setTransitions defers its write by a frame. */
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(node.style.background).toContain('gradient');

    Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });
    m.refresh();
    expect(node.style.background).toContain('#0a0');

    /** inertia must cover it, or the step would be a hard cut. */
    expect(node.style.transition).toContain('background');
    m.destroy();
    vi.unstubAllGlobals();
  });

  it('the module refuses url() without core knowing why', () => {
    wireMotion(paint);
    document.body.innerHTML =
      '<div data-vm data-vm-background="0% url(https://evil.test/x.png), 100% red"></div>';
    place(document.body.firstElementChild);
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    const why = m.rejected.flatMap((r) => r.rejected);
    expect(why.some((r) => r.includes('url('))).toBe(true);
    m.destroy();
  });
});
