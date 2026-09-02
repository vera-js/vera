import { describe, it, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

const MARKUP =
  '<p data-vm-split="words" ' +
  'data-vm-translate-y="0% 10px, 100% 0px">one two three</p>';

/**
 * Both preferences are live toggles on macOS and Windows, so the library
 * watches them rather than sampling once. These drive that listener directly.
 */
const watching = (query) => {
  const handlers = [];
  vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({
    matches: query.test(q),
    media: q,
    addEventListener: (_event, fn) => handlers.push(fn),
    removeEventListener: () => {},
  }));
  return (matches) => { for (const fn of handlers) fn({ matches }); };
};

afterEach(() => vi.restoreAllMocks());

/**
 * A module that rewrites the DOM is skipped while nothing will animate — the
 * `aria-hidden` spans `split` builds are pure cost for an animation that is not
 * going to run. So a page loaded under reduced motion has no pieces, and none
 * of the elements those pieces would have been.
 *
 * Re-enabling therefore has to *build* them, not re-style them. `enable()` did;
 * the media-query listener did not, and the two are the same instruction
 * arriving by different doors.
 */
describe('reduced motion turned off while the page is open', () => {
  it('builds what the module never got to build', () => {
    const fire = watching(/reduced/);
    document.body.innerHTML = MARKUP;
    const node = document.querySelector('p');
    const m = createMotion({ respectReducedMotion: true });
    m.init();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(m.elements).toHaveLength(0);

    fire(false);
    expect(m.reducedMotion).toBe(false);
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    expect(m.elements).toHaveLength(3);
    m.destroy();
    expect(node.innerHTML).toBe('one two three');
  });

  /**
   * The guard, and the reason this is not simply "collect on every toggle". A
   * page that *was* prepared keeps its pieces across a toggle by design, and
   * re-collecting would split the already-split text a second time.
   */
  it('does not rebuild a page that was already prepared', () => {
    const fire = watching(/nothing-matches/);
    document.body.innerHTML = MARKUP;
    const node = document.querySelector('p');
    const m = createMotion({ respectReducedMotion: true });
    m.init();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);

    fire(true);
    fire(false);
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    const copy = node.querySelector(':scope > span:not([aria-hidden])');
    const visible = [...node.childNodes].filter((n) => n !== copy).map((n) => n.textContent).join('');
    expect(visible).toBe('one two three');
    m.destroy();
    expect(node.innerHTML).toBe('one two three');
  });

  /**
   * The coarse-pointer preference shares the same resolver, so it shares the
   * fix. A hybrid device switching from touch to a mouse is the case.
   */
  it('does the same when the pointer stops being coarse', () => {
    const fire = watching(/coarse/);
    document.body.innerHTML = MARKUP;
    const node = document.querySelector('p');
    const m = createMotion({ respectReducedMotion: false, disableOnTouch: true });
    m.init();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(0);

    fire(false);
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    m.destroy();
  });

  /**
   * And a plain element was never affected: it is collected whether or not
   * anything will animate, so only what a module builds went missing. Asserted
   * so the fix is not read as covering more than it does.
   */
  it('was never a problem for an element no module builds', () => {
    const fire = watching(/reduced/);
    document.body.innerHTML =
      '<div data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>';
    const m = createMotion({ respectReducedMotion: true, inertia: 0 });
    m.init();
    expect(m.elements).toHaveLength(1);
    fire(false);
    expect(m.elements).toHaveLength(1);
    m.destroy();
  });
});
