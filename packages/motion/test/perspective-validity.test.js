import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * A `perspective` CSS will not take — and it takes the transform with it.
 *
 * `perspective()` requires a **non-negative length**: a percentage is invalid
 * and so is a negative one. The `length` setting type allows both, because it
 * is shared with `pin`, where `top: -20px` is perfectly ordinary.
 *
 * The consequence is worse than the usual one in this class. This function is
 * composed at the *front* of the element's transform, and an invalid function
 * invalidates the whole declaration — so `perspective="50%"` dropped the
 * element's translate, rotate and scale along with it. The element did not
 * animate at all, and `rejected` was empty.
 *
 * Verified in three engines rather than read off the specification:
 * `CSS.supports('transform', 'perspective(-100px) translateY(10px)')` is false,
 * and `perspective(0px)` is fine — it flattens rather than fails.
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
  document.body.innerHTML =
    `<div ${P} ${P}-perspective="${value}" ${P}-translate-y="0% 0px, 100% 40px"></div>`;
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

describe('a perspective CSS will not take', () => {
  it.each(['-100px', '-1rem', '50%', '-0.5vh'])('refuses %s', (value) => {
    const out = run(value);
    expect(out.said).toContain('is not a length CSS will take');
  });

  /**
   * The half that matters: the rest of the transform survives. Dropping the
   * setting and keeping the animation is the whole point — the alternative is
   * the browser dropping all of it.
   */
  it('and the element still animates without it', () => {
    const out = run('50%');
    expect(out.transform).toContain('translateY(');
    expect(out.transform).not.toContain('perspective(');
  });

  it('and says what would have happened', () => {
    expect(run('-100px').said).toContain('drops the whole transform');
  });

  it.each(['800px', '0px', '10vh', '1rem'])('accepts %s, as every engine does', (value) => {
    const out = run(value);
    expect(out.said).toBe('');
    expect(out.transform).toContain(`perspective(${value})`);
  });
});
