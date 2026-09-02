/**
 * The fifth insert point, and the one `runInserts` cannot cover.
 *
 * `easing` is the only chain whose links return a value, so it has its own loop
 * in `runtime.ts`. It was the only one left unguarded after the other four were
 * fixed: a resolver that threw took the exception out of `init()` and the
 * instance adopted **no elements at all** — in the one place a module runs per
 * element rather than per page.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';

wireMotion({ on: 'easing', fn: () => { throw new Error('easings module bug'); } });

let warnings;
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
  document.body.innerHTML =
    '<div id="a" data-vm data-vm-ease="ease-in" ' +
    'data-vm-opacity="0% 0, 100% 1"></div>' +
    '<div id="b" data-vm data-vm-opacity="0% 0, 100% 1"></div>';
});
afterEach(() => vi.restoreAllMocks());

const start = () => {
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

describe('an easing resolver that throws', () => {
  it('does not escape init()', () => {
    let m;
    expect(() => { m = start(); }).not.toThrow();
    m.destroy();
  });

  it('leaves every element adopted, including the one that asked for the ease', () => {
    const m = start();
    expect(m.elements.length).toBe(2);
    expect(m.enabled).toBe(true);
    m.destroy();
  });

  it('reports it on the element, so a GUI can see which one went straight', () => {
    const m = start();
    const reasons = m.rejected.filter((r) => r.node.id === 'a').flatMap((r) => r.rejected);
    expect(reasons).toEqual([expect.stringContaining('the easing module threw')]);
    m.destroy();
  });

  it('and says nothing about an element that never asked for one', () => {
    const m = start();
    const reasons = m.rejected.filter((r) => r.node.id === 'b').flatMap((r) => r.rejected);
    expect(reasons).toEqual([]);
    m.destroy();
  });
});

/**
 * A resolver answering a truthy non-function is the same broken module as a
 * throwing one, arriving through the value: `42` sailed into the curve and
 * `evaluate` threw `ease is not a function` out of init() on the first frame.
 */
describe('an easing insert that answers with something that is not a function', () => {
  it('is refused like a throw, and the element animates linear', () => {
    wireMotion([{ on: 'easing', fn: () => 42 }]);
    document.body.innerHTML =
      '<div data-vm data-vm-ease="ease-in" data-vm-opacity="0% 0, 100% 1"></div>';
    const node = document.body.firstElementChild;
    for (const [k, v] of [['offsetTop', 500], ['offsetHeight', 100], ['offsetParent', null]]) {
      Object.defineProperty(node, k, { value: v, configurable: true });
    }
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(node.style.filter, 'the control: still animating, on a straight line').toContain('opacity');
    expect(m.rejected.flatMap((r) => r.rejected).join('|')).toContain('the curve is linear');
    m.destroy();
  });
});

