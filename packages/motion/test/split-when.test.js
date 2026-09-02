import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

/**
 * `when` moves to the pieces with everything else, and a selector is evaluated
 * against whatever holds it — so splitting changes its *subject*.
 *
 * `when=".is-open"` on the paragraph becomes the same attribute on every span,
 * each asking "do I have `.is-open`?", which is never true. The words never
 * animate and nothing is refused, because nothing is wrong: the attribute is
 * valid and doing exactly what it says.
 *
 * Documented rather than fixed — naming the container is the natural spelling
 * and the one `when` already recommends — and pinned here so the documentation
 * and the behaviour cannot drift apart.
 */
const P = 'data-vera-motion';

const place = (node) => {
  for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200], ['offsetWidth', 200], ['offsetLeft', 0]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};
const settle = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const openPanelWith = async (selector) => {
  document.body.innerHTML =
    `<div id="panel" class="panel"><p id="p" ${P}-split="words" ${P}-when="${selector}" ` +
    `${P}-opacity="0% 0, 100% 1">one two</p></div>`;
  for (const node of document.querySelectorAll('div, p')) place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  for (const node of document.querySelectorAll('span')) place(node);
  document.getElementById('panel').classList.add('is-open');
  await settle();
  const values = [...document.querySelectorAll('#p span[aria-hidden]')].map((s) => s.style.filter);
  m.destroy();
  return values;
};

describe('`when` on a split paragraph', () => {
  it('names the piece, so a selector describing the container never matches', async () => {
    expect(await openPanelWith('.is-open')).toEqual(['opacity(0)', 'opacity(0)']);
  });

  it('and names the container when the selector says so', async () => {
    expect(await openPanelWith('.panel.is-open *')).toEqual(['opacity(1)', 'opacity(1)']);
  });

  it('a child combinator works too', async () => {
    expect(await openPanelWith('.is-open p > *')).toEqual(['opacity(1)', 'opacity(1)']);
  });

  /** Nothing is refused: the attribute is valid, and doing what it says. */
  it('says nothing either way, because nothing is wrong', async () => {
    document.body.innerHTML =
      `<div class="panel"><p ${P}-split="words" ${P}-when=".is-open" ` +
      `${P}-opacity="0% 0, 100% 1">one two</p></div>`;
    for (const node of document.querySelectorAll('div, p')) place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.rejected).toEqual([]);
    m.destroy();
  });
});
