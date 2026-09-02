import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, parseMeasure, getProperty } from '../src/index.ts';

/**
 * A magnitude this library cannot write as CSS.
 *
 * `String(n)` switches to exponential notation at 1e21, and CSS has no
 * exponential form for a length — so twenty-one digits composed
 * `translateY(1e+21px)`, which the engine drops whole. The element sat still,
 * `rejected` was empty, and the attribute looked right.
 *
 * Nothing bounded it. The measure pattern has no exponent form, so the only way
 * in is to type the digits out, and no length property declares a `max`.
 *
 * The bound is a billion rather than 1e21: an overshooting `cubic-bezier`
 * exceeds its own keyframe, so a bound set exactly where formatting breaks does
 * not hold after interpolation — and no layout is a billion pixels.
 */
const P = 'data-vera-motion';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 1500, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const run = (value) => {
  document.body.innerHTML = `<div ${P} ${P}-translate-y="0% 0px, 100% ${value}"></div>`;
  const node = document.body.firstElementChild;
  for (const [key, v] of [['offsetTop', 500], ['offsetHeight', 200]]) {
    Object.defineProperty(node, key, { value: v, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  const out = {
    said: m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | '),
    transform: node.style.transform,
  };
  m.destroy();
  return out;
};

describe('a value too large to write as CSS', () => {
  it('is refused rather than composed into exponential notation', () => {
    const out = run(`${'9'.repeat(21)}px`);
    expect(out.transform, 'never translateY(1e+21px)').not.toMatch(/e\+/);
    expect(out.said).toContain('translate-y');
  });

  /** The bound itself, either side of it. */
  it('accepts a billion and refuses ten', () => {
    expect(parseMeasure('1000000000px', getProperty('translate-y'))).not.toBeNull();
    expect(parseMeasure('10000000000px', getProperty('translate-y'))).toBeNull();
  });

  it('and the same on the negative side', () => {
    expect(parseMeasure('-1000000000px', getProperty('translate-y'))).not.toBeNull();
    expect(parseMeasure('-10000000000px', getProperty('translate-y'))).toBeNull();
  });

  /** Ordinary values are untouched, which is most of what this must not break. */
  it('and leaves ordinary values alone', () => {
    const out = run('40px');
    expect(out.said).toBe('');
    expect(out.transform).toContain('translateY(');
  });
});
