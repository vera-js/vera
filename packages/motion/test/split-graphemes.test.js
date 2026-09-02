import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createSplit } from '../src/modules/split.ts';

beforeEach(() => { document.body.innerHTML = ''; });

const split = (text) => {
  document.body.innerHTML = `<p>${text}</p>`;
  const node = document.querySelector('p');
  const made = createSplit(node, 'chars');
  /** Pieces only — the visually-hidden sentence copy is a span too, without aria-hidden. */
  return { node, made, pieces: [...node.querySelectorAll('span[aria-hidden]')].map((s) => s.textContent) };
};

/**
 * "Split by character" means what a reader calls a character. Splitting by
 * code point gives each piece its own `inline-block` box, so a combining mark
 * is torn off the letter it belongs to and a multi-code-point emoji comes
 * apart into its components.
 */
describe('chars splits by grapheme, not by code point', () => {
  it('keeps a multi-code-point emoji whole', () => {
    expect(split('👨‍👩‍👧').pieces).toEqual(['👨‍👩‍👧']);
  });

  it('keeps a flag whole', () => {
    expect(split('🇬🇧').pieces).toEqual(['🇬🇧']);
  });

  it('keeps a skin-tone modifier with its emoji', () => {
    expect(split('👍🏽').pieces).toEqual(['👍🏽']);
  });

  it('keeps a combining mark with its letter', () => {
    /** Decomposed: `e` followed by U+0301, which renders as one glyph. */
    expect(split('é').pieces).toEqual(['é']);
  });

  it('keeps a Devanagari cluster whole', () => {
    expect(split('नि').pieces).toEqual(['नि']);
  });

  it('still splits plain text one character per piece', () => {
    expect(split('abc').pieces).toEqual(['a', 'b', 'c']);
  });

  it('puts the text back exactly on destroy', () => {
    const { node, made } = split('a👨‍👩‍👧b');
    made.destroy();
    expect(node.textContent).toBe('a👨‍👩‍👧b');
  });

  it('counts pieces against the cap the same way it builds them', () => {
    /**
     * 600 family emoji is 600 graphemes and 3,000 code points. Counting code
     * points would refuse a split that is actually within the limit — and,
     * the other way round, would have let a 400-grapheme string through as
     * 400 while building far more pieces.
     */
    const many = '👨‍👩‍👧'.repeat(600);
    document.body.innerHTML = `<p>${many}</p>`;
    expect(createSplit(document.querySelector('p'), 'chars')).toBeNull();

    const few = '👨‍👩‍👧'.repeat(10);
    document.body.innerHTML = `<p>${few}</p>`;
    const made = createSplit(document.querySelector('p'), 'chars');
    expect(made).not.toBeNull();
    expect(document.querySelectorAll('span[aria-hidden]')).toHaveLength(10);
  });
});
