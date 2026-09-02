import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

/**
 * `collect()` is documented as a **re-scan**, and `scroll-to`'s collect has
 * always pruned — "anything it no longer tracks loses the active class and the
 * target marker attribute". This one only ever added.
 *
 * The mutation observer covers removal on an ordinary page, which is why it
 * went unnoticed. `observeMutations: false` is an option this library offers,
 * for a page that would rather call `collect()` itself, and there a removed
 * element stayed in the list for the life of the page: a strong reference to a
 * detached node and its whole subtree, updated every frame, and counted in
 * `elements.length`.
 */
const P = 'data-vm';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const PAIR =
  `<div id="a" ${P} ${P}-opacity="0% 0, 100% 1"></div>` +
  `<div id="b" ${P} ${P}-opacity="0% 0, 100% 1"></div>`;

const start = (options = {}) => {
  document.body.innerHTML = PAIR;
  const m = createMotion({ respectReducedMotion: false, inertia: 0, ...options });
  m.init();
  return m;
};

describe('collect()', () => {
  it('drops an element the page removed, with the observer off', () => {
    const m = start({ observeMutations: false });
    const a = document.getElementById('a');
    expect(m.elements).toHaveLength(2);

    a.remove();
    m.collect();

    expect(m.elements).toHaveLength(1);
    expect(m.elements[0].node.id).toBe('b');
    /** And hands the detached node back rather than leaving it styled. */
    expect(a.getAttribute('style')).toBeNull();
    m.destroy();
  });

  it('still adds what the page rendered', () => {
    const m = start({ observeMutations: false });
    document.getElementById('a').remove();
    document.body.insertAdjacentHTML(
      'beforeend', `<div id="c" ${P} ${P}-opacity="0% 0, 100% 1"></div>`
    );
    m.collect();
    expect(m.elements.map((e) => e.node.id).sort()).toEqual(['b', 'c']);
    m.destroy();
  });

  /**
   * Still in a *root*, not merely still connected: an element moved out of an
   * observed shadow root is gone from this instance's point of view even
   * though the document still holds it.
   */
  it('drops an element moved out of the root it was collected in', () => {
    document.body.innerHTML = `<div id="scope">${PAIR}</div><div id="elsewhere"></div>`;
    const scope = document.getElementById('scope');
    const m = createMotion({ respectReducedMotion: false, inertia: 0, root: scope, observeMutations: false });
    m.init();
    expect(m.elements).toHaveLength(2);

    document.getElementById('elsewhere').append(document.getElementById('a'));
    m.collect();

    expect(m.elements.map((e) => e.node.id)).toEqual(['b']);
    m.destroy();
  });

  /** A module hears about it too, or a split paragraph leaves its pieces behind. */
  it('releases a module that was holding the element', () => {
    document.body.innerHTML =
      `<p id="p" ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one two three</p>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    const p = document.getElementById('p');
    expect(p.querySelectorAll('span[aria-hidden]')).toHaveLength(3);

    p.remove();
    m.collect();

    expect(p.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(p.textContent).toBe('one two three');
    m.destroy();
  });

  it('does nothing when nothing has gone', () => {
    const m = start({ observeMutations: false });
    m.collect();
    m.collect();
    expect(m.elements).toHaveLength(2);
    m.destroy();
  });
});
