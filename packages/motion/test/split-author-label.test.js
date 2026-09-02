import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';
import { createSplit } from '../src/modules/split.ts';

wireMotion(split);

/**
 * Splitting replaces the text with `aria-hidden` spans, so the container needs
 * an accessible name or the content vanishes from the accessibility tree. It
 * wrote one unconditionally.
 *
 * An author who had already given the element an `aria-label` — a heading
 * labelled "Chapter 3: the argument", a link labelled for what it does — had it
 * replaced by the visible text the moment the element was split, and removed
 * outright on teardown. The label was gone for good, on a page the library
 * says it puts back.
 */
const P = 'data-vera-motion';

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

describe('an aria-label the author wrote', () => {
  it('survives the split unchanged', () => {
    const m = start(`<p id="p" aria-label="Chapter 3: the argument" ${P}-split="words" ` +
      `${P}-opacity="0% 0, 100% 1">one two three</p>`);
    const node = document.getElementById('p');
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    expect(node.getAttribute('aria-label')).toBe('Chapter 3: the argument');
    /** Their name is in charge — a hidden copy underneath it would double-speak. */
    expect(node.querySelector(':scope > span:not([aria-hidden])')).toBeNull();
    m.destroy();
    expect(node.getAttribute('aria-label')).toBe('Chapter 3: the argument');
    expect(node.textContent).toBe('one two three');
  });

  /** And where there was none, the split still supplies one and takes it back. */
  it('and the hidden copy the split adds is added and removed', () => {
    const m = start(`<p id="p" ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one two three</p>`);
    const node = document.getElementById('p');
    /** No aria-label any more — ARIA prohibits naming these roles; the copy is real text. */
    expect(node.hasAttribute('aria-label')).toBe(false);
    const copy = node.querySelector(':scope > span:not([aria-hidden])');
    expect(copy.textContent).toBe('one two three');
    m.destroy();
    expect(node.querySelector(':scope > span:not([aria-hidden])')).toBeNull();
    expect(node.textContent).toBe('one two three');
  });

  /**
   * A mode change restores and re-splits, which is the path that would put an
   * author's label back and then take it away on the second pass.
   */
  it('survives a mode change too', () => {
    document.body.innerHTML = '<p id="p" aria-label="mine">one two three</p>';
    const node = document.getElementById('p');
    const words = createSplit(node, 'words');
    expect(node.getAttribute('aria-label')).toBe('mine');
    words.destroy();
    const chars = createSplit(node, 'chars');
    expect(node.getAttribute('aria-label')).toBe('mine');
    chars.destroy();
    expect(node.getAttribute('aria-label')).toBe('mine');
    expect(node.textContent).toBe('one two three');
  });

  /** An empty label is a label: the author wrote it, and it is not ours to replace. */
  it('does not treat an empty label as absent', () => {
    document.body.innerHTML = '<p id="p" aria-label="">one two three</p>';
    const node = document.getElementById('p');
    const made = createSplit(node, 'words');
    expect(node.getAttribute('aria-label')).toBe('');
    made.destroy();
    expect(node.getAttribute('aria-label')).toBe('');
  });
});
