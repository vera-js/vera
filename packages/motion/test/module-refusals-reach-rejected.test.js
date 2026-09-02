import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

/**
 * A module refuses things about elements the instance knows by no other route.
 *
 * `rejected` was built from two lists — what was adopted, and what was dropped
 * — and a split **container** is in neither: its bare `data-vera-motion` marker
 * is optional, so the ordinary spelling has none and nothing parses it. Every
 * refusal about it was recorded in `rejections.ts` and read by nobody, while
 * the README said `rejected` holds every refusal, "including refusals a module
 * makes later" and naming text `split` will not touch as an example.
 *
 * `rejections.ts` can be enumerated now — weakly, so it is still never the
 * thing keeping a removed element alive — and the instance merges any refused
 * node inside its own roots.
 */
const P = 'data-vera-motion';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const reasons = (markup, options = {}) => {
  document.body.innerHTML = markup;
  const m = createMotion({ respectReducedMotion: false, inertia: 0, ...options });
  m.init();
  const out = m.rejected.flatMap((entry) => entry.rejected);
  m.destroy();
  return out;
};

describe('a refusal about an unmarked split container', () => {
  it('reaches `rejected` — nested markup', () => {
    expect(reasons(`<p ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one <b>two</b> three</p>`))
      .toEqual([`${P}-split needs plain text, not nested markup.`]);
  });

  /**
   * A mode this module does not know was skipped in silence. The schema
   * refuses it for a *marked* container — `split` is registered with an
   * `allowed` list — but the ordinary spelling has no marker, so nothing
   * parsed it: `split="word"` left the paragraph whole with no reason given.
   */
  it('and an unknown mode', () => {
    expect(reasons(`<p ${P}-split="word" ${P}-opacity="0% 0, 100% 1">one two</p>`))
      .toEqual([`${P}-split="word" is not one of chars, words, lines.`]);
  });

  /**
   * `pin` is the one moved attribute that cannot mean anything on a piece: it
   * says "hold this element", and the element meant is the paragraph. Moved, it
   * makes each word `position: sticky` inside the paragraph's own box.
   */
  it('and a `pin` that will land on every word', () => {
    expect(reasons(`<p ${P}-split="words" ${P}-pin="20px" ${P}-opacity="0% 0, 100% 1">one two</p>`))
      .toEqual([expect.stringContaining('cannot hold the container')]);
  });

  it('and says nothing about a container with nothing wrong with it', () => {
    expect(reasons(`<p ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one two</p>`)).toEqual([]);
  });

  /**
   * Scoped to this instance's roots. Wiring is page-level and the refusals are
   * not: another instance's container is not this one's to report.
   */
  it('but not about a container outside this instance\'s roots', () => {
    document.body.innerHTML =
      `<div id="mine"><p ${P}-split="words" ${P}-opacity="0% 0, 100% 1">fine here</p></div>` +
      `<div id="theirs"><p ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one <b>two</b></p></div>`;
    const mine = createMotion({
      respectReducedMotion: false, inertia: 0, root: document.getElementById('mine'),
    });
    const theirs = createMotion({
      respectReducedMotion: false, inertia: 0, root: document.getElementById('theirs'),
    });
    theirs.init();
    mine.init();

    expect(theirs.rejected.flatMap((e) => e.rejected)).toEqual([
      `${P}-split needs plain text, not nested markup.`,
    ]);
    expect(mine.rejected).toEqual([]);
    mine.destroy();
    theirs.destroy();
  });

  /** Listed once, not twice, when the container does carry the marker. */
  it('does not double-report a container that was also adopted', () => {
    document.body.innerHTML =
      `<p ${P} ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one <b>two</b> three</p>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.rejected).toHaveLength(1);
    m.destroy();
  });
});
