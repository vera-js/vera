import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { split } from '../src/split.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';

/**
 * Wired, and therefore synchronous — which is the whole reason the module
 * model replaced the chunk one.
 *
 * This file carried "the split module is an on-demand chunk; two macrotasks
 * covers the import" and a `settle()` that slept 40ms at eight call sites. All
 * five tests pass with it emptied: there is no import to wait for, and these
 * use `split="words"`, which has none of the `lines` mode's deferred rebuild
 * either. A wait for something that cannot happen, describing an architecture
 * that no longer exists — and the chunk-to-module change is exactly what
 * CLAUDE.md warns gets misremembered.
 */
wireMotion([split]);

const MARKUP =
  '<p data-vm data-vm-split="words" data-vm-opacity="0% 0, 100% 1">the quick fox</p>';

beforeEach(() => { document.body.innerHTML = ''; });

describe('split text across the instance lifecycle', () => {
  it('does not split when reduced motion is honoured', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    document.body.innerHTML = MARKUP;
    const node = document.querySelector('p');
    const m = createMotion({ respectReducedMotion: true });
    m.init();
    /** Splitting adds aria-hidden spans for an animation that will not run. */
    expect(node.innerHTML).toBe('the quick fox');
    expect(node.getAttribute('aria-label')).toBeNull();
    m.destroy();
    vi.restoreAllMocks();
  });

  it('splits once motion is explicitly enabled', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    document.body.innerHTML = MARKUP;
    const node = document.querySelector('p');
    const m = createMotion({ respectReducedMotion: true });
    m.init();
    m.enable();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    m.destroy();
    vi.restoreAllMocks();
  });

  /**
   * disable() puts the text back, so enable() has to rebuild it. It did not,
   * and a single editor toggle lost the split permanently — the same failure
   * the sequence re-attach in enable() exists to prevent.
   */
  /**
   * A toggle keeps the page as it is. `disable()` stops animating and strips
   * the styles; it no longer rewrites the DOM back, because doing so meant
   * `enable()` had to re-parse everything — which lost `run-once` state and
   * made an editor toggle expensive. `destroy()` is what puts the page back.
   */
  it('keeps the split across a disable/enable toggle', async () => {
    document.body.innerHTML = MARKUP;
    const node = document.querySelector('p');
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);

    m.disable();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    const visible = [...node.childNodes]
      .filter((n) => !(n.nodeType === 1 && !n.hasAttribute('aria-hidden')))
      .map((n) => n.textContent).join('');
    expect(visible).toBe('the quick fox');

    m.enable();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);

    m.destroy();
    expect(node.innerHTML).toBe('the quick fox');
  });

  /**
   * The mutation path took the ordinary adopt branch, so a split element the
   * page rendered after startup was animated as one block and never split.
   */
  /**
   * Explicitly, via `collect()`. A module that rewrites the DOM cannot be run
   * from inside the mutation observer's own callback without re-entering it,
   * so markup rendered later is collected on request — the same contract
   * `scroll-to.collect()` has always had for a nav rendered after init.
   */
  it('splits an element the page adds after init, once collected', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const m = createMotion({ respectReducedMotion: false });
    m.init();

    document.getElementById('host').innerHTML = MARKUP;
    m.collect();

    expect(document.querySelector('p').querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    m.destroy();
  });

  it('restores the text on destroy, however it was built', async () => {
    document.body.innerHTML = MARKUP;
    const node = document.querySelector('p');
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    m.destroy();
    expect(node.innerHTML).toBe('the quick fox');
    expect(node.getAttribute('aria-label')).toBeNull();
  });
});
