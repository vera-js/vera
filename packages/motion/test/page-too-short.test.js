import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * `100%` is where the element has *fully left* the scroll window, so an element
 * near the end of the document can never get there — nothing follows it to
 * scroll past. Measured on an ordinary page, a last section reached **0.222** of
 * its timeline and stopped: 78% of the animation an author wrote never
 * happening, with nothing said about it.
 *
 * The README already warns that a keyframe *beyond* 100% never completes. This
 * is the same outcome caused by the page rather than by the keyframe, and it is
 * the more likely of the two — writing `100%` is the ordinary thing to do, and
 * putting a section at the bottom of a page is not a mistake.
 */
const page = ({ scrollHeight, top, height = 200, keyframes, extra = '' }) => {
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
  document.body.innerHTML =
    `<div class="on" data-vera-motion ${extra} data-vera-motion-opacity="${keyframes}"></div>`;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

const said = (m) => m.rejected.flatMap((r) => r.rejected).join(' ');

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

afterEach(() => vi.unstubAllGlobals());

describe('an animation the page is not long enough to finish', () => {
  it('says so for an element at the very end', () => {
    /** 3,900 tall, 700 viewport: 3,200 of scroll. The element starts at 3,700. */
    const m = page({ scrollHeight: 3900, top: 3700, keyframes: '0% 0, 100% 1' });
    expect(said(m)).toContain('the page ends before this animation does');
    m.destroy();
  });

  it('says nothing for one with room to finish', () => {
    const m = page({ scrollHeight: 3900, top: 2000, keyframes: '0% 0, 100% 1' });
    expect(said(m)).toBe('');
    m.destroy();
  });

  /**
   * Against the element's own highest keyframe, not against 1. An animation
   * that finishes at 50% has finished, wherever it sits.
   */
  it('says nothing when the animation ends before 100% anyway', () => {
    const m = page({ scrollHeight: 3900, top: 3700, keyframes: '0% 0, 20% 1' });
    expect(said(m)).toBe('');
    m.destroy();
  });

  it('and does say so when a keyframe reaches past 100%', () => {
    const m = page({ scrollHeight: 3900, top: 2000, keyframes: '0% 0, 300% 1' });
    expect(said(m)).toContain('the page ends before this animation does');
    m.destroy();
  });

  /**
   * The reason this is a state and not a `reject()` call. `reject` is
   * append-only by design — a module refusing every frame must not turn the
   * diagnostic list into a leak — so a condition recorded through it can never
   * stop being true. The first version of this said the page was too short for
   * ever, naming an element that had since become perfectly able to finish.
   */
  it('stops saying so once the page is long enough', () => {
    const m = page({ scrollHeight: 3900, top: 3700, keyframes: '0% 0, 100% 1' });
    expect(said(m)).toContain('the page ends before this animation does');

    /** More content arrives below it. */
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
    m.refresh();
    expect(said(m)).toBe('');
    m.destroy();
  });

  /**
   * Silent on a page that cannot scroll at all. Nothing animates there, every
   * element is equally unfinishable, and saying so once per element is noise
   * about a different and larger problem.
   */
  it('stays quiet when the page cannot scroll at all', () => {
    const m = page({ scrollHeight: 700, top: 100, keyframes: '0% 0, 100% 1' });
    expect(said(m)).toBe('');
    m.destroy();
  });

  /**
   * And silent on a `when` element, where it was a false accusation.
   *
   * A state-driven element reaches `highestEnd` the moment its selector
   * matches; the page's height has nothing to do with whether it finishes. On
   * exactly the geometry that earns the warning above, this said "the page ends
   * before this animation does" about an animation that finishes whenever a
   * class is toggled.
   *
   * The same rule that refuses `ease` and `stagger` on a `when` element:
   * `when` replaces the scroll driver, and what depended on the driver goes
   * with it. A false reason costs what a missing one costs — the GUI renders
   * this list beside the real refusals.
   */
  it('stays quiet on a `when` element, which does not need the page to be long', () => {
    const m = page({
      scrollHeight: 3900, top: 3700, keyframes: '0% 0, 100% 1',
      extra: 'data-vera-motion-when=".on"',
    });
    expect(said(m)).not.toContain('the page ends before this animation does');
    m.destroy();
  });

  /** And the control: the same geometry without `when` still earns it. */
  it('and still says so for the scroll-driven element beside it', () => {
    const m = page({ scrollHeight: 3900, top: 3700, keyframes: '0% 0, 100% 1' });
    expect(said(m)).toContain('the page ends before this animation does');
    m.destroy();
  });
});
