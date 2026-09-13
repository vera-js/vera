/**
 * **The rule registry trusts a 32-bit hash as if it were the text it was derived from.**
 *
 * `acquire(root, hash, cssText)` looks the hash up and, on a hit, increments a count and DISCARDS
 * the `cssText` it was handed. `registry.ts` states the assumption in its own words — *"the cssText
 * is only read the first time a hash is seen; identical animations hand in identical text by
 * construction, since the hash IS the text"* — and that is the one thing a hash is not. `contentHash`
 * is FNV-1a over 32 bits, so distinct bodies can and do share a name.
 *
 * The collision below was FOUND by search, not assumed: `"r7wzx"` and `"ra6cd"` both hash to
 * `5cdf4d19`, from 474,782 candidates. When it happens, the second animation is never inserted and
 * every element that asked for it wears the first one's rule instead — silently, with no error
 * anywhere, because from the registry's point of view the rule it wanted was already there.
 *
 * Probability is the honest part of the severity: for N distinct rules on one page it is about
 * N²/2³³ — negligible at ten rules, around 1% at ten thousand. Rare, permanent when it happens, and
 * invisible. Which of the two available fixes is right is the owner's call, for the reasons set
 * out on the record below — neither is an audit repair.
 *
 * **This lives in the browser suite because it cannot be asked anywhere else.** Constructible
 * stylesheets and `adoptedStyleSheets` are absent under jsdom, so the registry's insert path never
 * runs there and a node-side pin would observe nothing at all.
 */
import { expect } from '@esm-bundle/chai';
import { contentHash, acquire, release } from '../../packages/motion/dist/development/vera-motion.js';

/** The colliding pair, restated here as data rather than recomputed — a search is not a spec. */
const LEFT = 'r7wzx';
const RIGHT = 'ra6cd';

const rulesOf = (root) =>
  [...root.adoptedStyleSheets].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText));

it('the collision is real in this engine, and the two bodies are distinct', () => {
  expect(contentHash(LEFT), 'the search result must still hold').to.equal(contentHash(RIGHT));
  expect(LEFT).to.not.equal(RIGHT);
});

/**
 * **A RECORD of the current behaviour, not a blessing of it.** The desired behaviour is that both
 * animations reach the sheet; what happens is that the second is discarded. This asserts what
 * happens so the record cannot rot — if the registry ever starts comparing the text it was handed,
 * or the hash widens, this test fails and that is the signal to delete it.
 *
 * The fix is NOT a dev warning: a collision needs thousands of distinct rules on one page, which is
 * a production shape, and a development diagnostic folds away exactly where it would be needed.
 *
 * **And the two candidate fixes are not the same size, which a first reading gets backwards.**
 * FNV-1a is not cryptographic, so the question is not only whether a collision happens by ACCIDENT
 * but whether one can be MADE — and those are different problems with different costs:
 *
 * - **Birthday** (the attacker controls BOTH bodies) is 2^(n/2): 2^16 here, instant. It buys
 *   nothing — making two of your own rules share a name is not an attack.
 * - **Second preimage** (collide with a rule ALREADY on the page, whose hash is public in the
 *   selector and in `data-vm-for`) is 2^n: **2^32 here, 2^64 at omni's width.** That is the attack
 *   this defect enables, and it is the number that matters.
 *
 * At 32 bits the second preimage is roughly a billion hashes per minute of ordinary hardware away.
 * At 64 bits the same work is geological. So a wider hash is NOT merely an accident fix — against
 * the real attack it is a 2^32 improvement.
 *
 * **An empirical demonstration was attempted and FAILED for instrument reasons, which is recorded
 * rather than dropped.** Six billion candidates over ~18 minutes produced no preimage, and that
 * null is worth nothing: the candidate family (a counter rendered into a fixed prefix/suffix)
 * turned out to sample the hash space non-uniformly — 3M candidates yielded 44 collisions where a
 * uniform hash gives ~1048, i.e. it maps near-injectively onto a SUBSET that need not contain the
 * target. A search whose space is not validated cannot distinguish "hard" from "looking in the
 * wrong place". The 2^32 figure above stands on arithmetic, not on that run.
 *
 * - **A wider hash** (omni's twin is 64-bit; the width difference is a recorded divergence, so
 *   closing it is a ratified-surface change rather than an audit repair) removes the ACCIDENT and
 *   moves the deliberate cost to 2^64. It does not close the class.
 * - **Comparing `cssText` on a hit** closes BOTH, for one string comparison. What it can do on a
 *   mismatch is the open question: this registry cannot rename, because the hash is already in the
 *   rule's selector AND in the element's `data-vm-for` marker by the time `acquire` sees it, so it
 *   can only refuse — which turns "wears the wrong animation" into "wears none, and says so".
 *   Renaming would mean re-deriving in `generate.ts`, and the marker's relationship to the content
 *   hash is adoption surface shared with omni.
 *
 * Whether the deliberate half is reachable here at all depends on the app: a motion value is
 * author-written, so it takes an application interpolating untrusted input into one. It buys a
 * cosmetic result — another element wearing your animation, no privilege crossing — so this is not
 * filed as a security finding. The asymmetry is recorded because it decides which fix is complete.
 * Owner's call, with omni in the loop either way. (The asymmetry is theirs; the timing is measured
 * here.)
 */
it('KNOWN: a second animation under a colliding hash is discarded, and the first is served', () => {
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  const root = host.shadowRoot;

  const hash = contentHash(LEFT);
  acquire(root, hash, `.vm-${LEFT} { opacity: 1; }`);
  const afterFirst = rulesOf(root);
  /** NON-ZERO CONTROL: with nothing inserted, everything below is vacuous. */
  expect(afterFirst.some((text) => text.includes(LEFT)), 'the first rule must actually be inserted')
    .to.equal(true);

  acquire(root, hash, `.vm-${RIGHT} { opacity: 0; }`);
  const afterSecond = rulesOf(root);

  expect(
    afterSecond.some((text) => text.includes(RIGHT)),
    'RECORD CHANGED: the second animation now reaches the sheet. The collision is fixed — delete ' +
      'this test rather than update it.'
  ).to.equal(false);
  expect(
    afterSecond.some((text) => text.includes(LEFT)),
    'and the first is what every element asking for either one still wears'
  ).to.equal(true);

  release(root, hash);
  release(root, hash);
  host.remove();
});

/**
 * The control that keeps the case honest: two animations whose hashes DIFFER must both be present.
 * Without it, a registry that inserted nothing on any second acquire would look identical to one
 * with a collision bug, and the finding above would be about the wrong thing.
 */
it('two animations with different hashes both reach the sheet', () => {
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  const root = host.shadowRoot;

  const a = contentHash('alpha');
  const b = contentHash('beta');
  expect(a, 'the control pair must not itself collide').to.not.equal(b);

  acquire(root, a, '.vm-alpha { opacity: 1; }');
  acquire(root, b, '.vm-beta { opacity: 0; }');
  const rules = rulesOf(root);

  expect(rules.some((text) => text.includes('alpha')), 'the first').to.equal(true);
  expect(rules.some((text) => text.includes('beta')), 'the second').to.equal(true);

  release(root, a);
  release(root, b);
  host.remove();
});
