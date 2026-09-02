import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { split } from '../src/split.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';

wireMotion([split]);

const settle = async () => {
  await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 20));
};

const MARKUP =
  '<p data-vera-motion data-vera-motion-split="words" data-vera-motion-opacity="0% 0, 100% 1">one two three</p>';

/**
 * The container of a removed split was retained by two node-keyed maps that
 * only destroy() emptied. `elements` reaching zero hid it — the pieces are
 * dropped correctly, it is the container that stayed.
 *
 * Reachability itself is checked in a browser with a WeakRef and a real GC
 * (`spikes/leak.mjs`); happy-dom cannot collect. What is observable here is
 * the consequence: a removed element must not be resurrected by a later
 * enable(), which is what a stale splitModes entry would do.
 */
describe('removing a split element', () => {
  it('does not leave it queued for a later enable()', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    const m = createMotion({ respectReducedMotion: false });
    m.init();

    host.innerHTML = MARKUP;
    await settle();
    m.collect();
    const detached = host.firstElementChild;
    expect(detached.querySelectorAll('span[aria-hidden]')).toHaveLength(3);

    host.innerHTML = '';
    await settle();
    expect(m.elements).toHaveLength(0);

    m.disable();
    m.enable();
    await settle();

    /** The detached node is nobody's business any more. */
    expect(detached.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(detached.textContent).toBe('one two three');
    m.destroy();
  });
});
