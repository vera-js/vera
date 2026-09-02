import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { sequence } from '../src/sequence.ts';

/**
 * `allowedOrigins` is a **list**, and a lone string is the way to get that
 * wrong: one origin, written as the thing it is rather than as a list of one.
 * It threw `flatMap is not a function` out of the factory, at module scope,
 * before any instance existed — the shape decision 31 named for `breakpoints`
 * (`{ mobile: 640 }` threw `number 640 is not iterable` out of `createMotion`),
 * on the option that governs this module's **security boundary**, where the
 * page going down is not the worst reading of the mistake.
 */
const P = 'data-vm';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  document.body.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const configReasons = (m) =>
  m.rejected.filter((entry) => entry.node === null).flatMap((entry) => entry.rejected);

describe('sequence allowedOrigins that is not a list', () => {
  for (const [name, value] of [
    ['a lone string', 'https://cdn.example'],
    ['a number', 42],
    ['an object', { 0: 'https://cdn.example' }],
  ]) {
    it(`refuses ${name} without taking the page down`, () => {
      expect(() => wireMotion(sequence({ allowedOrigins: value }))).not.toThrow();

      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();

      expect(m.elements, 'the page still animates').toHaveLength(1);
      expect(configReasons(m).join(' ')).toContain('allowedOrigins must be a list');
      m.destroy();
    });
  }

  /**
   * And it fails **closed**: refusing the option leaves the allowlist empty,
   * which is the same boundary a page that declared nothing gets.
   */
  it('and leaves the boundary where it was', () => {
    wireMotion(sequence({ allowedOrigins: 'https://cdn.example' }));
    document.body.innerHTML =
      `<canvas ${P} ${P}-frame="0% 0, 100% 9" ${P}-frame-url="https://cdn.example/s/" ${P}-frame-count="10"></canvas>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    const perElement = m.rejected.filter((entry) => entry.node !== null).flatMap((entry) => entry.rejected);
    expect(perElement.join(' '), 'the cross-origin url is still refused').toContain('frame-url');
    m.destroy();
  });

  /**
   * A real list still opens it, which is the control.
   *
   * Counted rather than matched: the page-level list is page-level, so the
   * refusals the cases above recorded are still in it — correctly, since a
   * page that mis-wired a module once has mis-wired it. What this asserts is
   * that a good list adds nothing to it.
   *
   * **Counted among `allowedOrigins` reasons only.** Calling the factory again
   * re-registers `frame` and its five settings with *new* descriptor objects,
   * which `wireMotion` now reports as replacing the ones already there — a
   * correct and separate fact, and one this test is not about. Counting every
   * reason made it fail on something true.
   */
  it('while a list of one adds no refusal', () => {
    const about = (m) => configReasons(m).filter((reason) => reason.includes('allowedOrigins'));
    const before = createMotion({ respectReducedMotion: false, inertia: 0 });
    before.init();
    const was = about(before).length;
    before.destroy();

    expect(() => wireMotion(sequence({ allowedOrigins: ['https://cdn.example'] }))).not.toThrow();

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(about(m)).toHaveLength(was);
    m.destroy();
  });
});
