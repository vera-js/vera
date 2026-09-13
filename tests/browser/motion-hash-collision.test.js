/**
 * **The registry trusted a name as if it were the text it was derived from. Now the name IS the
 * text, and this is what holds that closed in a real engine.**
 *
 * `acquire(root, hash, cssText)` looks the hash up and, on a hit, increments a count and DISCARDS
 * the `cssText` it was handed. That is correct only while the name is a function of the text. Twice
 * it was not:
 *
 * 1. **The name was 32 bits.** Distinct bodies collided by accident — `"r7wzx"` and `"ra6cd"` both
 *    hashed to `5cdf4d19`, found by search from 474,782 candidates. At ten thousand rules on a page
 *    that is about 1 in 83. It is now FNV-1a 64-bit spelled as fourteen base36 characters, which
 *    moves accidents to ~1 in 370 billion and a targeted second preimage from roughly 13 minutes to
 *    geological time. (A denser 11-character packing over `[A-Za-z0-9_-]` was built first and
 *    reversed: the 64-symbol alphabet is a literal gzip cannot compress, and it measured 105 B
 *    gzipped per bundle against three characters of marker that gzip erases.)
 * 2. **The name did not cover its own content**, which was the worse half and is why the pair above
 *    is only half the story. The marker was hashed from a curated summary of the parse — group
 *    hashes, eases, var names, the segment map — while `animation-range` was generated from the
 *    `scroll` setting, which appeared on no list. Two elements sharing keyframes and differing only
 *    in scroll range derived ONE name; the second's rule was discarded and that element silently
 *    animated over the first element's range, wherever native scroll timelines exist. No search
 *    required, no improbability — ordinary authoring. `generate.ts` now hashes the emitted rules
 *    themselves, with the marker held out of its own selector, so a body cannot depend on something
 *    the name does not see. `tests/motion-name-covers-css.test.mjs` sweeps that across the parser's
 *    whole settings vocabulary; this file is the engine-side half.
 *
 * **It lives in the browser suite because the insert path cannot be asked anywhere else.**
 * Constructible stylesheets and `adoptedStyleSheets` are absent under jsdom, so the registry takes
 * its `<style>` fallback there and a node-side pin would observe a different code path.
 */
import { expect } from '@esm-bundle/chai';
import { contentHash, acquire, release } from '../../packages/motion/dist/development/vera-motion.js';

/** The pair that collided at 32 bits, kept as DATA rather than recomputed — a search is not a spec,
 *  and the point of keeping them is that they must no longer collide. */
const LEFT = 'r7wzx';
const RIGHT = 'ra6cd';

const rulesOf = (root) =>
  [...root.adoptedStyleSheets].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText));

const withRoot = (run) => {
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  try {
    run(host.shadowRoot);
  } finally {
    host.remove();
  }
};

it('the pair that collided at 32 bits no longer does', () => {
  expect(LEFT).to.not.equal(RIGHT);
  expect(
    contentHash(LEFT),
    'these two bodies shared a name at 32 bits. If they share one again the width has regressed'
  ).to.not.equal(contentHash(RIGHT));
});

it('a name is fourteen base36 characters', () => {
  /** The format is adoption surface — it goes into `data-vm-motion` and into every selector built
   *  from it — so it is pinned rather than left to inference. */
  expect(contentHash('anything at all')).to.match(/^[0-9a-z]{14}$/);
});

it('two animations with different bodies both reach the sheet', () => {
  withRoot((root) => {
    const a = contentHash(LEFT);
    const b = contentHash(RIGHT);
    expect(a, 'the two must differ, or this asserts nothing').to.not.equal(b);

    acquire(root, a, `.vm-${LEFT} { opacity: 1; }`);
    acquire(root, b, `.vm-${RIGHT} { opacity: 0; }`);
    const rules = rulesOf(root);

    expect(rules.some((text) => text.includes(LEFT)), 'the first').to.equal(true);
    expect(rules.some((text) => text.includes(RIGHT)), 'the second').to.equal(true);

    release(a);
    release(b);
  });
});

/**
 * **The net, exercised directly rather than waited for.** A real collision is now unreachable —
 * that is the point of everything above — so the only honest way to test the refusal is to hand
 * `acquire` one key with two different bodies on purpose. It must keep the first and refuse the
 * second, never overwrite and never silently serve the wrong one.
 *
 * Refusing rather than renaming is forced: by the time `acquire` sees a body the name is already in
 * this rule's selector, in the `animation-name` referencing it, and on the element's marker — and
 * deciding WHICH body renames cannot be done without state, which activation order makes unusable
 * (`tests/motion-order-independence.test.mjs`).
 */
it('a second body under one key is refused, and the first is left intact', () => {
  withRoot((root) => {
    const key = contentHash('forced-key');
    acquire(root, key, '.vm-first { opacity: 1; }');
    expect(
      rulesOf(root).some((text) => text.includes('vm-first')),
      'NON-ZERO CONTROL: the first rule must actually be inserted, or everything below is vacuous'
    ).to.equal(true);

    acquire(root, key, '.vm-second { opacity: 0; }');
    const rules = rulesOf(root);

    expect(rules.some((text) => text.includes('vm-second')),
      'the mismatched body must not reach the sheet under a name derived from different text')
      .to.equal(false);
    expect(rules.some((text) => text.includes('vm-first')),
      'and the body that legitimately owns the name must survive').to.equal(true);

    release(key);
  });
});
