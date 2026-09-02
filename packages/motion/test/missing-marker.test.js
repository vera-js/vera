import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';
import { createScrollTo } from '../src/scroll-to.ts';

wireMotion(split);

/**
 * `data-vm` is the whole of `findElements`' selector, so an element
 * carrying `data-vm-opacity` and nothing else is not found, not
 * adopted, and not refused — it does not animate, with an empty `rejected` and
 * no console line.
 *
 * That is the one mistake the attribute design invites: the marker is the only
 * attribute that carries no information of its own, so it is the only one there
 * is nothing to remember it by. The GUI writes it every time; the other two
 * authors CLAUDE.md names — a person and an AI — forget it.
 */
const P = 'data-vm';

const place = (node) => {
  for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200], ['offsetWidth', 200]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const run = () => {
  for (const node of document.querySelectorAll('*')) place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};
const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

describe('an element with motion attributes and no marker', () => {
  it('is reported rather than passed over in silence', () => {
    document.body.innerHTML = `<div id="a" ${P}-opacity="0% 0, 100% 1"></div>`;
    const m = run();

    expect(m.elements, 'it is still not adopted').toEqual([]);
    expect(reasons(m)).toContain(`${P}-opacity`);
    expect(reasons(m)).toContain(`needs ${P}`);
    m.destroy();
  });

  it('and the entry names the element, so a GUI can point at it', () => {
    document.body.innerHTML = `<div id="a" ${P}-translate-y="0% 0px, 100% 40px"></div>`;
    const m = run();

    const entry = m.rejected.find((one) => one.node?.id === 'a');
    expect(entry).toBeTruthy();
    m.destroy();
  });

  it('and says nothing about one that has the marker', () => {
    document.body.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    const m = run();

    expect(m.elements).toHaveLength(1);
    expect(m.rejected).toEqual([]);
    m.destroy();
  });
});

/**
 * The three shapes that carry our attributes on an unmarked element **and are
 * correct**. All three are settings rather than properties, which is why the
 * rule is "a registered property" and not "any prefixed attribute" — the line
 * falls out of what a property is, rather than out of a list of exceptions that
 * would drift the moment a fourth one appeared.
 */
describe('and stays quiet about the elements that are meant to be unmarked', () => {
  it('a stagger host, whose children animate rather than itself', () => {
    document.body.innerHTML =
      `<div ${P}-stagger="10%">` +
      `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>` +
      `<div ${P} ${P}-opacity="0% 0, 100% 1"></div></div>`;
    const m = run();

    expect(m.elements).toHaveLength(2);
    expect(m.rejected).toEqual([]);
    m.destroy();
  });

  it('a split container, whose attributes moved to its pieces', () => {
    document.body.innerHTML =
      `<p ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one two three</p>`;
    const m = run();

    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    expect(m.rejected).toEqual([]);
    m.destroy();
  });

  it('and a scroll-to target, which this library marked itself', () => {
    document.body.innerHTML = `<a href="#t">go</a><div id="t"></div>`;
    const to = createScrollTo({ duration: 0 });
    to.init();
    expect(document.getElementById('t').hasAttribute(`${P}-scroll-target`)).toBe(true);

    const m = run();

    expect(m.rejected).toEqual([]);
    m.destroy();
    to.destroy();
  });

  /**
   * And an element something else already explained. A `split` refused for
   * nested markup keeps the attributes it would have moved, and has no marker
   * of its own — a second reason saying it needs one is not the problem and
   * would not fix it.
   */
  it('or one that already has a reason of its own', () => {
    document.body.innerHTML =
      `<p ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one <b>two</b></p>`;
    const m = run();

    expect(reasons(m)).toContain('plain text');
    expect(reasons(m), 'and only that').not.toContain('needs data-vm,');
    m.destroy();
  });
});

/**
 * The root itself, which every scan used to walk straight past.
 *
 * `querySelectorAll` does not match the node it is called on, and a
 * `TreeWalker` does not return the one it starts at — so an **element** handed
 * to `root:` or to `observe()` was the one node in its own subtree that could
 * not animate, and got no reason for it either.
 *
 * Two different answers, because the two halves are different questions. A
 * *marked* root is an element the author marked and then handed over, so it is
 * simply collected — `findElements` looks at the root now, and this needed no
 * diagnostic at all once the scan stopped skipping it. An *unmarked* one is the
 * ordinary missing-marker case, which the walk here had the same blind spot
 * about.
 *
 * A `Document` and a `ShadowRoot` carry no attributes, so this is only ever
 * about the element case — which is what `createMotion({ root: section })` and
 * `observe(section)` both are.
 */
describe('an animated element that is its own instance root', () => {
  const P = 'data-vm';
  const place = (node) => {
    for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200]]) {
      Object.defineProperty(node, key, { value, configurable: true });
    }
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
    return node;
  };
  const rooted = (html) => {
    document.body.innerHTML = html;
    const root = document.getElementById('r');
    for (const node of document.querySelectorAll('*')) place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, root });
    m.init();
    return m;
  };
  const said = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

  it('animates, and says nothing', () => {
    const m = rooted(`<div id="r" ${P} ${P}-opacity="0% 0, 100% 1"></div>`);
    expect(m.elements).toHaveLength(1);
    expect(m.elements[0].node.id).toBe('r');
    expect(said(m)).toBe('');
    m.destroy();
  });

  /**
   * First, because document order is what `stagger` indexes by — a root
   * collected after its own children would offset the whole group by one.
   */
  it('and is collected before its children', () => {
    const m = rooted(
      `<div id="r" ${P} ${P}-opacity="0% 0, 100% 1">` +
      `<p ${P} ${P}-opacity="0% 0, 100% 1"></p></div>`
    );
    expect(m.elements.map((element) => element.node.tagName)).toEqual(['DIV', 'P']);
    m.destroy();
  });

  /** Without a marker it is the ordinary missing-marker case, which also never reached the root. */
  it('gets the missing-marker reason when it has no marker', () => {
    const m = rooted(`<div id="r" ${P}-opacity="0% 0, 100% 1"></div>`);
    expect(said(m)).toContain(`${P}-opacity needs ${P} on the same element`);
    m.destroy();
  });

  /**
   * And says nothing about a root carrying only the bare marker. That is the
   * ordinary shape of a container someone scoped an instance to, and there is
   * nothing on it that was meant to animate.
   */
  it('says nothing about a root with the marker and no animation', () => {
    const m = rooted(`<div id="r" ${P}><p ${P} ${P}-opacity="0% 0, 100% 1"></p></div>`);
    expect(m.elements, 'the child still animates').toHaveLength(1);
    expect(said(m)).toBe('');
    m.destroy();
  });
});
