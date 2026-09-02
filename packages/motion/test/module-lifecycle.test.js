import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

const settle = async () => {
  await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 20));
};

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * `drop()` is the runtime's own bookkeeping and is used for two different
 * things: an element leaving, and an element being re-parsed. Telling a module
 * "this is going away" on a re-parse is false, and the consequence was not
 * subtle — `@verajs/motion/split` put the paragraph back together, `prepare`
 * split it again, and the two chased each other until the heap ran out.
 */
describe('a module is not told an element is leaving when it is only re-parsed', () => {
  it('keeps the split when a piece is re-parsed', async () => {
    document.body.innerHTML =
      '<p data-vera-motion data-vera-motion-split="words" data-vera-motion-opacity="0% 0, 100% 1">one two three</p>';
    const node = document.querySelector('p');
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await settle();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);

    /** An attribute edit on a piece forces exactly that re-parse. */
    node.querySelector('span[aria-hidden]').setAttribute('data-vera-motion-opacity', '0% 0.2, 100% 1');
    await settle();

    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    const copy = node.querySelector(':scope > span:not([aria-hidden])');
    const visible = [...node.childNodes].filter((n) => n !== copy).map((n) => n.textContent).join('');
    expect(visible).toBe('one two three');
    m.destroy();
  });

  /**
   * The split container itself is never registered — `createSplit` moves the
   * animation attributes onto the pieces — so re-parsing it cannot reach
   * `release` through that module at all. The contract is what needs guarding,
   * and a recording module states it without depending on any one module's
   * internals: a registered element that is merely re-parsed is not released.
   */
  it('does not release a registered element that is only re-parsed', async () => {
    const released = [];
    wireMotion({ on: 'release', fn: (node) => released.push(node) });

    document.body.innerHTML =
      '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const node = document.querySelector('div');
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await settle();

    node.setAttribute('data-vera-motion-opacity', '0% 0.5, 100% 1');
    await settle();
    expect(released).toEqual([]);

    /** The same element leaving for real is exactly when it must be released. */
    node.remove();
    await settle();
    expect(released).toEqual([node]);
    m.destroy();
  });
});
