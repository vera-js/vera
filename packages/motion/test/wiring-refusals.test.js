import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';

/**
 * `wireMotion` is a public export and the documented call is
 * `wireMotion(split)`. A **default** import of a named export is `undefined`,
 * which is the ordinary way to get this wrong, and it threw `Cannot use 'in'
 * operator to search for 'on' in undefined` at module scope — before `init()`,
 * taking the page's own script down with it, for a mistake whose worst honest
 * consequence is one module not being wired.
 *
 * Reported into `rejected` rather than only warned about: that is the list the
 * GUI renders, and a page whose module never wired otherwise sees its
 * attributes reported as unknown with no reason why.
 */
const P = 'data-vera-motion';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  document.body.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const configReasons = (m) =>
  m.rejected.filter((entry) => entry.node === null).flatMap((entry) => entry.rejected);

describe('wireMotion given something that is not a module', () => {
  for (const [name, value] of [
    ['undefined', undefined],
    ['null', null],
    ['a string', 'split'],
    ['a number', 7],
    ['an array holding one', [null]],
    ['a factory that returns one', () => null],
  ]) {
    it(`refuses ${name} without taking the page down`, () => {
      expect(() => wireMotion(value)).not.toThrow();

      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();

      expect(m.elements, 'the page still animates').toHaveLength(1);
      expect(configReasons(m).join(' ')).toContain('is not a module');
      m.destroy();
    });
  }
});
