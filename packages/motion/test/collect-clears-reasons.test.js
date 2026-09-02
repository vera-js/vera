import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { split } from '../src/split.ts';

wireMotion(split);

/**
 * A refusal is about the markup as it was when it was read, and `collect()`
 * reads it again.
 *
 * `applyChanges` already prunes parse-time reasons for the batch it re-parses,
 * because in the GUI that writes these attributes a broken value otherwise
 * accumulated one entry per keystroke. `collect()` — the path a page drives by
 * hand, and the only one when `observeMutations` is off — pruned nothing:
 * an element whose attribute was a typo at `init()` and has since been
 * corrected animated perfectly while `rejected` went on reporting the mistake.
 */
const P = 'data-vera-motion';

const place = (node) => {
  for (const [key, value] of [['offsetTop', 1000], ['offsetLeft', 0], ['offsetWidth', 200], ['offsetHeight', 200]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 1100, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected);

describe('collect() clears what it is about to re-read', () => {
  /**
   * `collect()` re-reads an element it has already adopted — the whole root,
   * every time, which is what "re-scan" says and what `scroll-to`'s collect
   * has always done.
   *
   * It did not, and the reason was `adopt`: it returns the runtime element it
   * already holds and discards the fresh parse, which is right for two
   * overlapping roots registering one element twice and wrong for this. The
   * consequence was that `observeMutations: false` — an option this library
   * offers — left a page **no way at all** to update an element after it was
   * adopted. `collect()` now hands the roots to `reparse`, the mutation
   * observer's own path, so the two agree.
   */
  it('re-reads an adopted element, reasons and all', () => {
    document.body.innerHTML =
      `<div id="a" ${P} ${P}-opactiy="0% 0, 100% 1" ${P}-opacity="0% 0, 100% 1"></div>`;
    const node = document.getElementById('a');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    expect(reasons(m)).toHaveLength(1)
    expect(reasons(m)[0].startsWith(`${P}-opactiy: `)).toBe(true)
    expect(reasons(m)[0]).toMatch(/no such attribute/);

    node.removeAttribute(`${P}-opactiy`);
    m.collect();

    expect(reasons(m)).toEqual([]);
    m.destroy();
  });

  /** And the value itself, not only the diagnostics: the animation changes. */
  it('and picks up an edited value, with the observer off', () => {
    document.body.innerHTML =
      `<div id="a" ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    const node = document.getElementById('a');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    const before = node.style.filter;

    node.setAttribute(`${P}-opacity`, '0% 1, 100% 1');
    m.collect();

    expect(node.style.filter).toBe('opacity(1)');
    expect(node.style.filter).not.toBe(before);
    m.destroy();
  });

  /** The observer does the same, and did so first. */
  it('while the mutation observer re-reads it within a microtask', async () => {
    document.body.innerHTML =
      `<div id="a" ${P} ${P}-opactiy="0% 0, 100% 1" ${P}-opacity="0% 0, 100% 1"></div>`;
    const node = document.getElementById('a');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(reasons(m)).toHaveLength(1)
    expect(reasons(m)[0].startsWith(`${P}-opactiy: `)).toBe(true)
    expect(reasons(m)[0]).toMatch(/no such attribute/);

    node.removeAttribute(`${P}-opactiy`);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reasons(m)).toEqual([]);
    m.destroy();
  });

  /**
   * And a module's reason, which lives in a different place and outlived the
   * mistake the same way.
   */
  it('drops a module reason once the markup is fixed', () => {
    document.body.innerHTML =
      `<p id="p" ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one <b>two</b></p>`;
    const node = document.getElementById('p');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    expect(reasons(m)).toEqual([`${P}-split needs plain text, not nested markup.`]);

    node.textContent = 'one two';
    m.collect();

    expect(reasons(m)).toEqual([]);
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(2);
    m.destroy();
  });

  /**
   * The case that found it: a module wired *after* `init()`. Its property was
   * an unknown attribute at parse time, and stayed reported after a `collect()`
   * had made it work.
   */
  it('drops the reason for a property whose module arrived late', () => {
    document.body.innerHTML = `<div id="c" ${P} ${P}-background="0% red, 100% blue"></div>`;
    const node = document.getElementById('c');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    expect(reasons(m)).toHaveLength(1)
    expect(reasons(m)[0].startsWith(`${P}-background: `)).toBe(true)
    expect(reasons(m)[0]).toMatch(/no such attribute/);

    wireMotion(paint);
    m.collect();

    expect(reasons(m)).toEqual([]);
    expect(node.style.background || node.style.backgroundColor).toBeTruthy();
    m.destroy();
  });

  /**
   * Removing the marker is the one gesture that means "stop animating this",
   * and with the observer off `collect()` is the only thing that can hear it.
   * The element is not in the scan any more — an unmarked node is not what
   * `findElements` selects — so nothing re-read it, nothing dropped it, and it
   * went on being updated every frame with its last inline transform. The
   * reason recorded about it outlived it the same way.
   */
  it('lets go of an element whose marker was removed', () => {
    document.body.innerHTML =
      `<div id="a" ${P} ${P}-opactiy="0% 0, 100% 1" ${P}-opacity="0% 0, 100% 1"></div>`;
    const node = document.getElementById('a');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    expect(m.elements).toHaveLength(1);
    expect(reasons(m)).toHaveLength(1)
    expect(reasons(m)[0].startsWith(`${P}-opactiy: `)).toBe(true)
    expect(reasons(m)[0]).toMatch(/no such attribute/);

    node.removeAttribute(P);
    m.collect();

    expect(m.elements).toEqual([]);
    expect(node.style.filter).toBe('');
    /**
     * And says so, which is the one place two correct behaviours meet.
     *
     * Removing the marker is *the* documented gesture for "stop animating
     * this", so this element is exactly where its author put it. It is also an
     * element carrying `data-vera-motion-opacity` and no marker, which is the
     * commonest hand-authoring mistake and silent without this. The library
     * cannot tell the two apart, and what it reports is true of both: the
     * element has motion attributes and is not animated. `rejected` already
     * carries advisories of that kind — a page too short to finish an
     * animation, a `pin` that cannot hold — rather than refusals only.
     */
    expect(reasons(m).join(' ')).toContain('needs data-vera-motion');
    m.destroy();
  });

  /**
   * The same for an element that never parsed at all. Its reason lives in a
   * different list — `dropped`, not the runtime element's own — and the
   * re-read prunes that list only for the nodes it re-reads. An unmarked node
   * is not one of them, so without a prune of its own its reason is the last
   * thing left of an element this instance has otherwise entirely forgotten.
   */
  it('and of the reason for one that never parsed', () => {
    document.body.innerHTML = `<div id="a" ${P} ${P}-opactiy="0% 0, 100% 1"></div>`;
    const node = document.getElementById('a');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    expect(m.elements).toEqual([]);
    expect(reasons(m)).toHaveLength(1)
    expect(reasons(m)[0].startsWith(`${P}-opactiy: `)).toBe(true)
    expect(reasons(m)[0]).toMatch(/no such attribute/);

    node.removeAttribute(P);
    m.collect();

    expect(reasons(m)).toEqual([]);
    m.destroy();
  });

  /**
   * And re-reads only what changed, which is the difference between a
   * `collect()` a page can call after every render and one it cannot: reading
   * everything again means measuring everything again, which is **78ms at
   * 5,000 elements** against 9.7ms for the comparison alone.
   * `spikes/collect-cost.mjs` holds the numbers. They read 4.0 seconds and
   * 13.5ms when this was written — that gap was a quadratic in `clearElement`,
   * not the cost of a re-read, and `spikes/teardown-cost.mjs` now guards it.
   *
   * Identity is the test: a re-read builds a new runtime element, so the same
   * object coming back is the whole claim.
   */
  it('and rebuilds nothing when nothing changed', () => {
    document.body.innerHTML =
      `<div id="a" ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    place(document.getElementById('a'));
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    const before = m.elements[0];

    m.collect();

    expect(m.elements[0]).toBe(before);
    m.destroy();
  });

  /**
   * A stagger offset is the one parse input that is not on the element. The
   * step lives on the host and the index is document order among the
   * descendants that host staggers — so an element can need re-reading with
   * every one of its own attributes untouched.
   */
  it('re-reads a cascade when the step on its host changes', () => {
    document.body.innerHTML =
      `<div id="host" ${P}-stagger="10%">` +
      `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>` +
      `<div ${P} ${P}-opacity="0% 0, 100% 1"></div></div>`;
    for (const node of document.querySelectorAll('div')) place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    const before = m.elements.map((element) => element.parsed.stagger);

    document.getElementById('host').setAttribute(`${P}-stagger`, '40%');
    m.collect();

    expect(m.elements.map((element) => element.parsed.stagger)).not.toEqual(before);
    m.destroy();
  });

  /** And when the order changes, which moves every index after it. */
  it('re-reads a cascade when one of its elements moves', () => {
    document.body.innerHTML =
      `<div id="host" ${P}-stagger="10%">` +
      `<div id="one" ${P} ${P}-opacity="0% 0, 100% 1"></div>` +
      `<div id="two" ${P} ${P}-opacity="0% 0, 100% 1"></div></div>`;
    for (const node of document.querySelectorAll('div')) place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    const offsetOf = (id) =>
      m.elements.find((element) => element.node.id === id).parsed.stagger;
    const before = offsetOf('two');

    const host = document.getElementById('host');
    host.insertBefore(document.getElementById('two'), document.getElementById('one'));
    m.collect();

    expect(offsetOf('two')).not.toEqual(before);
    expect(offsetOf('one')).toEqual(before);
    m.destroy();
  });

  /** A reason that is still true is still reported. */
  it('keeps a reason the markup still deserves', () => {
    document.body.innerHTML =
      `<div id="a" ${P} ${P}-opactiy="0% 0, 100% 1" ${P}-opacity="0% 0, 100% 1"></div>`;
    place(document.getElementById('a'));
    const m = createMotion({ respectReducedMotion: false, inertia: 0, observeMutations: false });
    m.init();
    m.collect();
    expect(reasons(m)).toHaveLength(1)
    expect(reasons(m)[0].startsWith(`${P}-opactiy: `)).toBe(true)
    expect(reasons(m)[0]).toMatch(/no such attribute/);
    m.destroy();
  });
});
