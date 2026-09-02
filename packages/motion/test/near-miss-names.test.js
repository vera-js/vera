/**
 * What the library says when a *name* is almost right.
 *
 * Pass 31 fixed how a bad **value** is explained; this is the other half, and
 * for an attribute API aimed at CMS authors it is the commonest support
 * burden there is. Two things are asserted:
 *
 *   - The message must not claim the attribute does not exist. It used to say
 *     "not an attribute this library has — check the spelling", which is false
 *     for the ordinary mistake with a modular library: `background` and
 *     `split` are real, spelled correctly, and belong to a module nobody
 *     wired. That reading sends an author hunting for a typo in the one thing
 *     that is not wrong.
 *   - Where the slip is a *spelling system* rather than a mistyped letter —
 *     `translateY`, `translate_y`, `fadeup` — the right name is suggested.
 *     Deliberately no edit-distance guessing: a confident wrong suggestion
 *     costs more than none.
 *
 * All of it is `__DEV__`-only; production keeps `unknown attribute`.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const reasons = (markup) => {
  document.body.innerHTML = markup;
  const node = document.body.firstElementChild;
  for (const [key, value] of [
    ['offsetTop', 900], ['offsetHeight', 200], ['offsetWidth', 200], ['offsetParent', null],
  ]) Object.defineProperty(node, key, { value, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  const said = m.rejected.flatMap((entry) => entry.rejected);
  m.destroy();
  return said.join(' ');
};

beforeEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(16); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a name that is almost right', () => {
  /** The control: a correct attribute is refused nothing at all. */
  it('says nothing about a name that is right', () => {
    expect(reasons('<div data-vera-motion data-vera-motion-translate-y="40px"></div>')).toBe('');
  });

  it('suggests the real name for a camelCase or underscored one', () => {
    /** The DOM lowercases attribute names, so `translateY` arrives flattened. */
    expect(reasons('<div data-vera-motion data-vera-motion-translateY="40px"></div>'))
      .toMatch(/did you mean data-vera-motion-translate-y\?/);
    expect(reasons('<div data-vera-motion data-vera-motion-translate_y="40px"></div>'))
      .toMatch(/did you mean data-vera-motion-translate-y\?/);
  });

  it('suggests the real preset for a run-together one', () => {
    expect(reasons('<div data-vera-motion="fadeup"></div>')).toMatch(/did you mean "fade-up"\?/);
  });

  /** A mistyped letter is not guessed at — no threshold, no confident wrong answer. */
  it('does not invent a suggestion for a mistyped letter', () => {
    const said = reasons('<div data-vera-motion data-vera-motion-opacty="0"></div>');
    expect(said).toMatch(/no such attribute/);
    expect(said).not.toMatch(/did you mean/);
  });

  /**
   * The finding this file exists for: a real module attribute, spelled
   * correctly, with the module unwired. The reason must not accuse the
   * spelling, and must name the thing that is actually wrong.
   */
  it('points at the wiring for an attribute whose module is not wired', () => {
    for (const markup of [
      '<div data-vera-motion data-vera-motion-background="0% red, 100% blue"></div>',
      '<div data-vera-motion data-vera-motion-split="chars"></div>',
    ]) {
      const said = reasons(markup);
      expect(said).toMatch(/wire the module that provides it/);
      expect(said).not.toMatch(/not an attribute this library has/);
    }
  });
});
