import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';
import { EVENTS } from '../src/modules/events.ts';

/**
 * `run-once` means once **ever**, and `vera-motion:complete` is documented as
 * firing "once, ever". `resetElement` says so in as many words and refuses to
 * clear the latch on a re-measure.
 *
 * A re-parse builds a fresh runtime element, which starts unlatched, and
 * nothing carried the latch across. In the GUI that writes these attributes
 * that is every keystroke: a latched element reverted to its first keyframe —
 * a faded-in block going blank while its author edited an unrelated setting —
 * and fired a second `complete`.
 *
 * The position travels with the flag. Latched means "played through and stayed
 * there", and a fresh element starts at 0, so carrying only the flag left a
 * state-driven element painting its *first* keyframe for ever: the same revert
 * by a longer road.
 */
const P = 'data-vera-motion';

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

const start = (markup) => {
  document.body.innerHTML = markup;
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

const STATE = `<div id="a" ${P} ${P}-run-once ${P}-when=".on" ${P}-opacity="0% 0, 100% 1"></div>`;

describe('a latched run-once element that is re-parsed', () => {
  it('stays where it played to, and completes only once', async () => {
    const m = start(STATE);
    const node = document.getElementById('a');
    const seen = [];
    document.addEventListener(EVENTS.complete, () => seen.push('complete'));

    node.classList.add('on');
    await settle();
    expect(node.style.filter).toBe('opacity(1)');

    /** What a GUI does on every keystroke: rewrite an unrelated attribute. */
    node.setAttribute(`${P}-opacity`, '0% 0, 100% 1');
    await settle();

    expect(node.style.filter).toBe('opacity(1)');
    expect(seen).toEqual(['complete']);

    /** And the selector coming back does not replay it either. */
    node.classList.remove('on');
    await settle();
    node.classList.add('on');
    await settle();
    expect(seen).toEqual(['complete']);
    m.destroy();
  });

  /** Only ever set: one that had not latched must still be free to. */
  it('leaves an unlatched element free to latch afterwards', async () => {
    const m = start(STATE);
    const node = document.getElementById('a');
    const seen = [];
    document.addEventListener(EVENTS.complete, () => seen.push('complete'));

    node.setAttribute(`${P}-opacity`, '0% 0, 100% 1');
    await settle();
    expect(seen).toEqual([]);
    expect(node.style.filter).toBe('opacity(0)');

    node.classList.add('on');
    await settle();
    expect(seen).toEqual(['complete']);
    expect(node.style.filter).toBe('opacity(1)');
    m.destroy();
  });

  /**
   * Removing `run-once` un-latches the element, which is behaviour worth
   * pinning — though not the guard that spells it: every reader of
   * `runOnceRan` asks `runOnce` first, so this passes either way. The guard is
   * documented as defensive where it is written.
   */
  it('does not carry a latch onto an element that is no longer run-once', async () => {
    const m = start(STATE);
    const node = document.getElementById('a');
    node.classList.add('on');
    await settle();
    expect(node.style.filter).toBe('opacity(1)');

    node.removeAttribute(`${P}-run-once`);
    await settle();
    node.classList.remove('on');
    await settle();

    /** No longer latched, so it follows the selector again. */
    expect(node.style.filter).toBe('opacity(0)');
    m.destroy();
  });
});
