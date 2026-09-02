import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const P = 'data-vera-motion';
const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const settle = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((r) => setTimeout(r, 30));
};

beforeEach(() => { document.body.innerHTML = ''; });

const build = (inner, options = {}) => {
  document.body.innerHTML = `<div ${P}-stagger="20%">${inner}</div>`;
  for (const node of document.querySelectorAll('div')) place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0, ...options });
  m.init();
  return m;
};

/**
 * Stagger shifts keyframes along the *scroll* timeline. `when` replaces the
 * scroll driver, so the offset has nothing to act on — the row lands in unison,
 * which is the one thing stagger exists to prevent.
 */
describe('stagger on a state-driven element', () => {
  const ITEM = `<div ${P} ${P}-when=".on" ${P}-translate-y="0% 0px, 100% 40px"></div>`;

  it('is reported rather than silently doing nothing', () => {
    const m = build(ITEM + ITEM);
    const reasons = m.rejected.flatMap((entry) => entry.rejected);
    expect(reasons.filter((r) => r.includes('does nothing on a'))).toHaveLength(1);
    expect(reasons[0]).toContain('replaces the scroll driver');
    m.destroy();
  });

  it('lands the row in unison, which is what the report is about', async () => {
    const m = build(ITEM + ITEM + ITEM, { inertia: 0.4 });
    await settle();
    const items = [...document.querySelectorAll(`[${P}]`)];
    for (const item of items) item.setAttribute('class', 'on');
    await settle();

    const transforms = new Set(items.map((i) => i.style.transform));
    expect(transforms.size, 'all three end at the same value').toBe(1);
    const delays = new Set(items.map((i) => i.style.transition));
    expect(delays.size, 'and share one transition, with no per-item delay').toBe(1);
    m.destroy();
  });

  it('says nothing for a scroll-driven child of the same parent', () => {
    const m = build(`<div ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>`.repeat(2));
    expect(m.rejected.flatMap((e) => e.rejected)).toEqual([]);
    m.destroy();
  });

  it('reports only the state-driven child in a mixed group', () => {
    const m = build(
      `<div ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>` +
      `<div ${P} ${P}-when=".on" ${P}-translate-y="0% 0px, 100% 40px"></div>`
    );
    const reported = m.rejected.filter((e) => e.rejected.some((r) => r.includes('does nothing on a')));
    expect(reported).toHaveLength(1);
    expect(reported[0].node.getAttribute(`${P}-when`)).toBe('.on');
    m.destroy();
  });

  it('says nothing about the first child, which has no offset anyway', () => {
    const m = build(ITEM);
    expect(m.rejected.flatMap((e) => e.rejected)).toEqual([]);
    m.destroy();
  });
});

/**
 * A stagger host that staggers nothing, and is not itself animated.
 *
 * `parseElement` already refuses this — and reaches only the elements it
 * parses, which are the marked ones. `stagger` belongs on an **unmarked**
 * parent by design, so the most ordinary version of the mistake was the one
 * version nothing could see: a wrapper whose children lost their markers, or
 * never had them.
 */
describe('a stagger host with nothing animated under it', () => {
  const PRE = 'data-vera-motion';
  const build = (html) => {
    document.body.innerHTML = html;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    return m;
  };
  const said = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

  it('is reported even though it carries no marker of its own', () => {
    const m = build(`<div ${PRE}-stagger="10%"><p>not animated</p></div>`);
    expect(said(m)).toContain('needs animated descendants');
    m.destroy();
  });

  it('and says nothing when the children are animated', () => {
    const m = build(
      `<div ${PRE}-stagger="10%"><p ${PRE} ${PRE}-opacity="0% 0, 100% 1"></p></div>`
    );
    expect(said(m)).toBe('');
    m.destroy();
  });

  /**
   * A split container is the documented pairing — `split` plus `stagger` on one
   * heading — and its pieces do not exist when this runs. Exempt here exactly
   * as it is at parse time.
   */
  it('and says nothing about a split container that has not been split yet', () => {
    const m = build(`<p ${PRE}-split="words" ${PRE}-stagger="10%">one two three</p>`);
    expect(said(m)).toBe('');
    m.destroy();
  });

  /** And it clears itself once animated children arrive. */
  it('and stops saying it when animated children arrive', () => {
    const m = build(`<div id="h" ${PRE}-stagger="10%"></div>`);
    expect(said(m)).toContain('needs animated descendants');
    document.getElementById('h').innerHTML =
      `<p ${PRE} ${PRE}-opacity="0% 0, 100% 1"></p>`;
    m.collect();
    expect(said(m)).toBe('');
    m.destroy();
  });
});
