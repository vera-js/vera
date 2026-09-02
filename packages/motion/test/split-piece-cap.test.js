/**
 * The cap on how many pieces a split may make.
 *
 * `split="chars"` on a long paragraph is the shape that runs away: every
 * character becomes an element the runtime then parses, measures and animates,
 * so a page can ask for thousands of them by writing one attribute. The count
 * is taken **before anything is built**, and counted the way it will be built,
 * so the cap guards the number it is about to create rather than a different
 * one.
 *
 * Refusing leaves the element animating as a single block, which is the quiet
 * failure the reporting exists for — nothing looks broken, the text simply
 * arrives all at once.
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
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

const start = (text, mode = 'chars') => {
  document.body.innerHTML =
    `<p id="p" data-vera-motion data-vera-motion-split="${mode}" ` +
    `data-vera-motion-opacity="0% 0, 100% 1">${text}</p>`;
  const m = createMotion({ respectReducedMotion: false });
  m.init();
  return m;
};
const pieces = () => document.querySelectorAll('#p > span[aria-hidden]').length;
const reasons = (m) => m.rejected.map((r) => r.rejected).flat();

describe('a split that would make too many pieces', () => {
  const huge = 'x'.repeat(600);

  it('is refused rather than built', () => {
    const m = start(huge);
    expect(pieces()).toBe(0);
    m.destroy();
  });

  it('says how many it would have made, and what the limit is', () => {
    const m = start(huge);
    expect(warnings.some((w) => w.includes('600') && w.includes('500'))).toBe(true);
    m.destroy();
  });

  it('and reports it, since the element still animates as one block', () => {
    const m = start(huge);
    expect(reasons(m).some((r) => r.includes('over the'))).toBe(true);
    m.destroy();
  });

  it('leaves the text exactly as it was', () => {
    const m = start(huge);
    expect(document.getElementById('p').textContent).toBe(huge);
    m.destroy();
  });
});

describe('a split within the cap', () => {
  it('is built, and says nothing', () => {
    const m = start('hello there');
    expect(pieces()).toBeGreaterThan(0);
    expect(reasons(m)).toEqual([]);
    expect(warnings).toEqual([]);
    m.destroy();
  });

  /**
   * Counted the way it will be built: `chars` ignores whitespace, so a string
   * whose *length* is over the cap can still be under it once spaces are
   * dropped. Counting the raw string would refuse this one.
   */
  it('counts characters the way it splits them', () => {
    const spaced = `${'y '.repeat(300)}`.trim();
    const m = start(spaced);
    expect(spaced.length).toBeGreaterThan(500);
    expect(pieces()).toBeGreaterThan(0);
    expect(reasons(m)).toEqual([]);
    m.destroy();
  });

  /**
   * The same rule for words: spaces are tokens the split puts back as text,
   * not pieces. Counting them refused a ~250-word paragraph at half the cap.
   */
  it('counts words the way it splits them', () => {
    const spaced = 'word '.repeat(300).trim();
    const m = start(spaced, 'words');
    expect(pieces()).toBe(300);
    expect(reasons(m)).toEqual([]);
    m.destroy();
  });

  it('still refuses too many words', () => {
    const m = start('word '.repeat(600).trim(), 'words');
    expect(pieces()).toBe(0);
    expect(reasons(m).some((r) => r.includes('over the'))).toBe(true);
    m.destroy();
  });
});
