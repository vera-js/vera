import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * A **closed** shadow root cannot be discovered from outside — `element.shadowRoot`
 * is null, which is what closed means — so a framework built on them hands every
 * root over individually. Vera does exactly that from its `'init'` insert, one
 * `observe()` per component, at every depth, with `element._root` as the
 * reference and `element._cleanups` as the matching `unobserve`.
 *
 * So the number of calls is the number of components, and each call used to
 * write style and then read geometry, forcing a full layout every time round.
 * Measured: **779 ms to mount 400 components and 478 ms to unmount them**,
 * against 5.4 ms for the same 400 elements in one tree; a CPU profile put 89%
 * of it in the `offsetParent` walk, and 400 of those walks cost 0.2 ms with
 * layout clean against 277 ms with one style write between each.
 *
 * Adoption is batched to a microtask for that reason and no other. It is a
 * microtask rather than a frame so nothing is ever visible un-animated —
 * `spikes/roots-cost.mjs` holds the numbers.
 */
const P = 'data-vm';
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const closedRoot = (n) => {
  const host = document.createElement(`my-c${n}`);
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
  const node = root.firstElementChild;
  for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200], ['offsetWidth', 200]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  return { host, root };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  document.body.innerHTML = '';
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('many closed roots handed over one at a time', () => {
  it('adopts every one of them', async () => {
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const roots = Array.from({ length: 20 }, (_, i) => closedRoot(i));

    for (const { root } of roots) m.observe(root);
    await settled();

    expect(m.elements).toHaveLength(20);
    m.destroy();
  });

  /**
   * **Adoption is synchronous; painting is not.** That is the whole shape of
   * the fix: what a caller can observe — `instance.elements` — is right the
   * moment `observe()` returns, and what lands a microtask later is the writes,
   * because a write at the end of one call is exactly what made the next one's
   * geometry read force a layout.
   */
  it('adopts synchronously, and paints in one batch afterwards', async () => {
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const roots = Array.from({ length: 5 }, (_, i) => closedRoot(i));

    for (const { root } of roots) m.observe(root);

    expect(m.elements, 'adopted, without waiting').toHaveLength(5);
    expect(roots[0].root.firstElementChild.style.filter, 'painted a microtask later').toBe('');
    await settled();
    expect(roots[0].root.firstElementChild.style.filter).not.toBe('');
    m.destroy();
  });

  it('and gives every one back', async () => {
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const roots = Array.from({ length: 20 }, (_, i) => closedRoot(i));
    for (const { root } of roots) m.observe(root);
    await settled();

    for (const { root } of roots) m.unobserve(root);
    await settled();

    expect(m.elements).toEqual([]);
    for (const { root } of roots) {
      expect(root.firstElementChild.style.filter, 'and leaves nothing behind').toBe('');
    }
    m.destroy();
  });

  /**
   * A root registered and given up in the same turn is never adopted — the
   * batch has to notice it left before it runs, or `unobserve` releases
   * elements that do not exist yet and the batch adopts them afterwards.
   */
  it('and never adopts one that left before the batch ran', async () => {
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const { root } = closedRoot(0);

    m.observe(root);
    m.unobserve(root);
    await settled();

    expect(m.elements).toEqual([]);
    m.destroy();
  });

  /** Each root keeps its own watcher, so giving one up leaves the others watched. */
  it('and keeps watching the roots it still holds', async () => {
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const a = closedRoot(0);
    const b = closedRoot(1);
    m.observe(a.root);
    m.observe(b.root);
    await settled();

    m.unobserve(a.root);
    await settled();

    const late = document.createElement('div');
    late.setAttribute(P, '');
    late.setAttribute(`${P}-opacity`, '0% 0, 100% 1');
    b.root.appendChild(late);
    await settled();

    expect(m.elements, 'b is still watched').toHaveLength(2);
    m.destroy();
  });
});

/**
 * A component that unmounts without calling `unobserve` used to leave its root
 * behind for ever. `roots` was only added to by `observe()` and removed from by
 * `unobserve()`, and a detached `ShadowRoot` still answers `querySelectorAll` —
 * so the root was scanned on every `collect()` and its elements updated every
 * frame, holding a strong reference to a detached subtree. They passed the
 * `inRoots` test, which is exactly what stopped the element prune reaching them.
 *
 * Vera drains `element._cleanups` on `disconnectedCallback`, so it does call
 * `unobserve`. This is for everyone who does not.
 */
describe('a root whose host has left the document', () => {
  it('is dropped, and its elements with it', async () => {
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const { host, root } = closedRoot(0);
    m.observe(root);
    await settled();
    expect(m.elements).toHaveLength(1);

    host.remove();
    m.collect();

    expect(m.elements, 'the detached element is not updated for ever').toEqual([]);
  });

  /** A host that is *moved* is removed and re-added in the same turn, and stays. */
  it('but a root whose host only moved is kept', async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const { host, root } = closedRoot(0);
    document.getElementById('a').appendChild(host);
    m.observe(root);
    await settled();
    expect(m.elements).toHaveLength(1);

    document.getElementById('b').appendChild(host);
    m.collect();

    expect(m.elements, 'a move is not a removal').toHaveLength(1);
    m.destroy();
  });
});
