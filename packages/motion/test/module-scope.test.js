import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

const settle = async () => {
  await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 20));
};

const PARAGRAPH = (text) =>
  `<p data-vera-motion data-vera-motion-split="words"
      data-vera-motion-opacity="0% 0, 100% 1">${text}</p>`;

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.restoreAllMocks(); });

/**
 * Wiring is page-level; instances are not. Every module's state therefore lives
 * in module scope, and the `teardown` insert used to sweep all of it — so
 * destroying one instance handed back paragraphs a second, still-live instance
 * was animating.
 */
describe('a module tears down only what the instance destroying it owns', () => {
  it('leaves a second instance’s split alone', async () => {
    document.body.innerHTML =
      `<section id="a">${PARAGRAPH('one two three')}</section>` +
      `<section id="b">${PARAGRAPH('four five six')}</section>`;
    const a = createMotion({ root: document.querySelector('#a'), respectReducedMotion: false });
    const b = createMotion({ root: document.querySelector('#b'), respectReducedMotion: false });
    a.init();
    b.init();
    await settle();
    expect(document.querySelectorAll('#a span[aria-hidden]')).toHaveLength(3);
    expect(document.querySelectorAll('#b span[aria-hidden]')).toHaveLength(3);

    a.destroy();
    await settle();

    /** Its own goes back... */
    expect(document.querySelectorAll('#a span[aria-hidden]')).toHaveLength(0);
    expect(document.querySelector('#a p').textContent).toBe('one two three');
    /** ...and the instance still running keeps the pieces it is animating. */
    expect(document.querySelectorAll('#b span[aria-hidden]')).toHaveLength(3);

    b.destroy();
    await settle();
    expect(document.querySelectorAll('#b span[aria-hidden]')).toHaveLength(0);
  });
});

/**
 * `prepared` says whether `prepare` has ever run with anything to animate, and
 * `enable()` collects only when it is false. It is per-instance state that
 * `destroy()` did not clear, so it survived into the same instance's *next*
 * `init()` — and an instance that came back up suppressed then had its
 * `enable()` skip the collect entirely.
 */
describe('a destroyed instance leaves nothing behind for its own next run', () => {
  it('splits on enable() after being re-initialised under reduced motion', async () => {
    let reduced = false;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query.includes('reduced-motion') && reduced,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    document.body.innerHTML = PARAGRAPH('one two three');
    const m = createMotion({ respectReducedMotion: true });

    /** A first, ordinary run: this is what sets the flag. */
    m.init();
    await settle();
    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(3);

    m.destroy();
    await settle();
    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(0);

    /** The same instance back up, this time suppressed. */
    reduced = true;
    m.init();
    await settle();
    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(0);

    /** The authoring escape hatch has to reach the module, stale flag or not. */
    m.enable();
    await settle();
    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    m.destroy();
  });

  it('enable() does nothing on an instance that was never started', () => {
    document.body.innerHTML = PARAGRAPH('one two three');
    const m = createMotion({ respectReducedMotion: false });
    m.enable();
    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(m.elements).toHaveLength(0);
  });

  it('enable() does not resurrect a destroyed instance', async () => {
    document.body.innerHTML = PARAGRAPH('one two three');
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await settle();
    m.destroy();
    await settle();

    m.enable();
    await settle();
    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(m.elements).toHaveLength(0);
  });
});
