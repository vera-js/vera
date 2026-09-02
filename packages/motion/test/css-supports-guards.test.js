import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';

/**
 * The guards that ask the engine, tested by giving them an engine that says no.
 *
 * Three places let CSS decide what is valid rather than carrying a parser:
 * `@verajs/motion/paint` for a colour, the `transformOrigin` option, and the
 * SVG path the runtime writes as an `offset-path`. Every one of them is
 * **invisible to this suite by default** — happy-dom answers `true` from
 * `CSS.supports` for anything, including values no engine accepts, which one of
 * those docblocks already says in as many words.
 *
 * So the branch that matters, the one that *refuses*, was never taken here. A
 * mutation removing the path guard survived for exactly that reason, and it was
 * the mutation runner that pointed it out.
 *
 * Stubbing `CSS` is not a convenience in these tests; it is the only way the
 * behaviour exists for the suite at all. What the real engines answer is a
 * separate question, and `spikes/steps-validity.mjs`, `origin-validity.mjs` and
 * `path-validity.mjs` are what ask it.
 */
const P = 'data-vera-motion';

wireMotion(paint);

const place = (node) => {
  for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const start = (html, options = {}) => {
  document.body.innerHTML = html;
  for (const node of document.querySelectorAll('div')) place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0, ...options });
  m.init();
  return m;
};

const said = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 1500, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('an engine that refuses the value', () => {
  it('refuses a transformOrigin it will not take', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    const m = start(`<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`, { transformOrigin: 'nonsense' });
    expect(said(m)).toContain('transformOrigin');
    m.destroy();
  });

  it('and keeps one it will', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const m = start(`<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`, { transformOrigin: 'top left' });
    expect(said(m)).not.toContain('transformOrigin');
    m.destroy();
  });

  it('refuses a paint value it will not take', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    const m = start(`<div ${P} ${P}-background="0% rgb(9,9,9), 100% rgb(8,8,8)"></div>`);
    expect(said(m)).toContain('background');
    m.destroy();
  });

  it('and keeps a paint value it will', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const m = start(`<div ${P} ${P}-background="0% rgb(7,7,7), 100% rgb(6,6,6)"></div>`);
    expect(said(m)).not.toContain('background');
    m.destroy();
  });
});
