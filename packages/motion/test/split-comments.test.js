/**
 * A comment node is not text, and splitting one destroys it.
 *
 * The refusal checked `node.children`, which is **elements only**, so a comment
 * passed it, was split like ordinary text, and did not come back:
 *
 *     before  "the <!-- c --> fox"
 *     after   "the  fox"
 *
 * `textContent` was preserved throughout — that is the invariant this module
 * guards, and a comment is not part of it, which is exactly why nothing noticed.
 *
 * It matters because a comment node is how Vue, Svelte, lit and htmx anchor
 * themselves in a page, and because `destroy()` is documented to give back what
 * it borrowed. Taking something away permanently is worse than refusing to
 * touch the element at all — which is what it does now.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

let warnings;
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
});
afterEach(() => vi.restoreAllMocks());

const A = 'data-vm';
const page = (inner) => {
  document.body.innerHTML =
    `<p id="p" ${A} ${A}-split="words" ${A}-opacity="0% 0, 100% 1">${inner}</p>`;
  return document.getElementById('p');
};

describe('an element containing a comment', () => {
  for (const [where, inner] of [
    ['in the middle', 'the <!-- c --> fox'],
    ['at the start', '<!--anchor-->the fox'],
    ['at the end', 'the fox<!--tail-->'],
  ]) {
    it(`is refused, ${where}`, () => {
      const node = page(inner);
      const before = node.innerHTML;
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();

      expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
      expect(node.innerHTML).toBe(before);
      expect(m.rejected.flatMap((r) => r.rejected))
        .toEqual([expect.stringContaining('not comments')]);

      m.destroy();
      /** The comment is still there, which is the whole point. */
      expect(node.innerHTML).toBe(before);
    });
  }

  it('and the element still animates, as one block', () => {
    const node = page('the <!-- c --> fox');
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.refresh();
    expect(m.elements).toHaveLength(1);
    expect(node.style.filter).not.toBe('');
    m.destroy();
  });

  it('says so on the console as well as in rejected', () => {
    page('the <!-- c --> fox');
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(warnings.some((w) => w.includes('not comments'))).toBe(true);
    m.destroy();
  });

  /** Nested markup keeps its own wording, so the two are told apart. */
  it('and nested markup still says nested markup', () => {
    page('the <strong>quick</strong> fox');
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.rejected.flatMap((r) => r.rejected))
      .toEqual([expect.stringContaining('not nested markup')]);
    m.destroy();
  });
});

/**
 * A split with nothing for the pieces to inherit.
 *
 * A split *copies* the element's animation attributes onto every piece — that
 * is the whole mechanism, and the attribute reference says so. With none to
 * copy it produced spans that animate nothing, hid every one of them behind
 * `aria-hidden`, and moved the text onto the container as an `aria-label`: an
 * accessibility restructure bought with nothing at all, in silence.
 *
 * The module's own `prepare` already declines to split when nothing will
 * animate — `if (!enabled) return`, on the grounds that "`aria-hidden` spans
 * for an animation that will not run are pure cost". Per *element* that
 * reasoning had never been applied, and per element is where an author makes
 * the mistake.
 */
describe('a split with no animation attributes to move', () => {
  const A = 'data-vm';
  const start = (html) => {
    document.body.innerHTML = html;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    return m;
  };
  const said = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

  it('is refused, and says what splitting would have cost', () => {
    const m = start(`<p ${A}-split="words">one two</p>`);
    expect(said(m)).toContain('has nothing to animate');
    expect(said(m)).toContain('hides its text from assistive technology');
    m.destroy();
  });

  it('and leaves the paragraph whole and readable', () => {
    const m = start(`<p id="p" ${A}-split="words">one two</p>`);
    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(document.getElementById('p').getAttribute('aria-label')).toBeNull();
    m.destroy();
  });

  it('and says nothing when there is something to inherit', () => {
    const m = start(`<p ${A} ${A}-split="words" ${A}-opacity="0% 0, 100% 1">one two</p>`);
    expect(said(m)).toBe('');
    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(2);
    m.destroy();
  });

  /**
   * `stagger` alone is not something to inherit — it stays on the container by
   * design, so a split carrying only that still animates nothing.
   */
  it('and is not fooled by a stagger, which stays on the container', () => {
    const m = start(`<p ${A}-split="words" ${A}-stagger="10%">one two</p>`);
    expect(said(m)).toContain('has nothing to animate');
    m.destroy();
  });
});
