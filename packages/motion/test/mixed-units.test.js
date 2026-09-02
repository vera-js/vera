import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * One unit per curve is right: the values are interpolated against each other,
 * and a curve running from `rem` to `vh` means nothing. A bare number has to
 * inherit from somewhere, so the first keyframe carrying an explicit unit sets
 * it for the whole animation.
 *
 * A later keyframe carrying a *different* one is a contradiction rather than an
 * omission, and it was resolved in silence: `"0% 0px, 100% 40rem"` produced
 * `translateY(40px)`, which is a sixteenth of what was asked for, with nothing
 * on the channel the README sends people to.
 */
const run = (value, options = {}) => {
  document.body.innerHTML = `<div data-vera-motion data-vera-motion-translate-y="${value}"></div>`;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: 3000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 100, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0, ...options });
  m.init();
  const out = { transform: node.style.transform, said: m.rejected.flatMap((r) => r.rejected) };
  m.destroy();
  return out;
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 12000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 500, configurable: true });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('two units in one animation', () => {
  it('says which one it used, and uses it', () => {
    const { transform, said } = run('0% 0px, 100% 40rem');
    expect(transform).toBe('translateY(40px)');
    expect(said.join(' ')).toContain('rem and px in one animation');
    expect(said.join(' ')).toContain('px is used throughout');
  });

  it('says nothing when a bare number inherits, which is the whole rule', () => {
    expect(run('0% 0px, 100% 40').said).toEqual([]);
    expect(run('0% 0, 100% 40px').said).toEqual([]);
  });

  it('nor when they agree', () => {
    expect(run('0% 0px, 100% 40px').said).toEqual([]);
    expect(run('0% 0rem, 100% 40rem').said).toEqual([]);
  });

  /** Once per animation, not once per offending keyframe. */
  it('is said once however many disagree', () => {
    const { said } = run('0% 0px, 50% 10rem, 100% 40vh');
    expect(said).toHaveLength(1);
  });

  /** A band's keyframes are part of the same curve and answer to the same unit. */
  it('and covers a band that disagrees with the base', () => {
    const { said } = run('0% 0px, 100% 40px; [0-700]: 100% 40rem');
    expect(said.join(' ')).toContain('rem and px in one animation');
  });
});
