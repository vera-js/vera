/**
 * The deferred transition write against an element dropped in its window.
 *
 * `setTransitions` writes on the next animation frame, and the cancellers
 * cover whole batches — `destroy()` and `disable()` cancel everything owed.
 * What they cannot cover is one element leaving a batch: an attribute edit
 * queues the write, removing the marker re-parses and `clearElement`s the
 * node, and the frame then wrote the transition back onto an element no
 * instance held — an inline style nothing could ever clean. Two keystrokes in
 * an editor. Found by observer-path chaos (every seed), fixed by asking
 * "still held?" per element at fire time.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const settle = () => new Promise((r) => setTimeout(r, 0));
const place = (n) => {
  for (const [k, v] of [['offsetTop', 500], ['offsetHeight', 100], ['offsetParent', null]])
    Object.defineProperty(n, k, { value: v, configurable: true });
};

let frames;
beforeEach(() => {
  document.body.innerHTML = '';
  frames = [];
  /** Captured, not run — the test decides when the deferred write fires. */
  vi.stubGlobal('requestAnimationFrame', (fn) => frames.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

const flushFrames = () => { const run = frames.splice(0); for (const fn of run) fn(16); };

describe('an element dropped between the transition queue and the frame', () => {
  it('is not written back after its clearElement', async () => {
    document.body.innerHTML =
      '<div id="a" data-vera-motion data-vera-motion-translate-y="0% 0, 100% 100px"></div>';
    const node = document.getElementById('a');
    place(node);

    const m = createMotion({ respectReducedMotion: false, inertia: 0.1 });
    m.init();
    flushFrames();
    expect(node.style.transition, 'the control: the ordinary path writes it').toContain('transform');

    /** The edit queues a fresh deferred write for the re-adopted element… */
    node.setAttribute('data-vera-motion-translate-y', '0% 0, 100% 200px');
    await settle();
    /** …and the unmark drops and clears it before that frame fires. */
    node.removeAttribute('data-vera-motion');
    await settle();
    expect(node.style.transition, 'cleared by the drop').toBe('');

    flushFrames();
    expect(node.style.transition,
      'the stale batch must not restyle a node the instance no longer holds').toBe('');

    m.destroy();
  });
});
