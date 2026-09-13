/**
 * **A rule's NAME must cover every rule it names — measured against the parser's own vocabulary.**
 *
 * The marker in `data-vm-motion` is a registry KEY: `acquire` looks it up and, on a hit, keeps the
 * rule it already has and discards the text it was handed. That is correct only while the name is a
 * function of the text. It was not. The name used to be hashed from a hand-curated summary of the
 * parse — group hashes, eases, var names, the segment map — while `animation-range` was built from
 * `settings.scroll`, which was on no list. So:
 *
 *     <div data-vd-motion="{ keyframes: {…}, scroll: '0 1'     }">   marker LdiLPEn5X1F
 *     <div data-vd-motion="{ keyframes: {…}, scroll: '0.2 0.8' }">   marker LdiLPEn5X1F
 *
 * — one name, two animations, the second discarded, the second element silently wearing the first
 * element's scroll range wherever native scroll timelines exist. Ordinary authoring; no diagnostic.
 *
 * `generate.ts` now hashes the emitted rules themselves, so the class is closed by construction.
 * This suite is what keeps it closed, and the way it enumerates is the whole point: **the settings
 * come from `settings()`, the parser's own vocabulary, never from a list written here.** A curated
 * list is exactly the defect under test — one written in this file would forget `scroll` for the
 * same reason the hash did, and would then certify the bug as fixed.
 *
 * The assertion is a BICONDITIONAL, because both directions are defects with different costs:
 * same name + different CSS is the silent-wrong-animation above; different name + identical CSS is
 * needless fragmentation, a duplicate rule per variant in a shared sheet. A setting that never
 * reaches CSS (`fill`, `once`, `root`) must therefore still SHARE its name — that is the dedupe
 * working, and the fix had to preserve it rather than split everything apart.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node',
  'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];

const { fromAttribute } = await load('motion');
const { settings } = await load('motion/internal');

/** A body that generates real rules under every variant, so each row actually has CSS to compare.
 *  A tick-only element emits nothing and would make every row vacuously equal. */
const KEYFRAMES = "keyframes: { opacity: '0% 0, 100% 1' }";

/**
 * Two distinct, VALID values per setting TYPE — by type, never by key, so the map does not become
 * the curated list this suite exists to refuse. Numbers derive their pair from the definition's own
 * bounds. A setting whose type is missing here, or whose values the parser refuses, FAILS the run
 * rather than skipping: a new setting must be thought about once, and the alternative is a row that
 * silently proves nothing.
 */
const VALUES = {
  number: (def) => [String(def.min ?? 0), String(Math.min(def.max ?? 1, 1))],
  boolean: () => ['true', 'false'],
  length: () => ["'100px'", "'200px'"],
  easing: () => ["'linear'", "'ease-in'"],
  selector: () => ["'#a'", "'#b'"],
  range: () => ["'0 1'", "'0.2 0.8'"],
  string: () => ["'--a'", "'--b'"],
  offset: () => ["'10%'", "'20%'"],
  origin: () => ["'top'", "'center'"],
};

/**
 * Every rule the runtime acquires under a marker-derived key: `#b`/`#t`/`#on`/`#nj`/`#rm` in
 * transition mode and `#el`/`#n`/`#m{i}` in seek mode (`runtime.ts`). Keyframes rules are excluded
 * deliberately — they carry their own content hashes and are not exposed to this defect.
 *
 * **The list is checked against the object rather than trusted.** The first draft of this file
 * named only the seek-mode rules and so compared nothing in transition mode, where `play` lives —
 * it reported "different marker, identical CSS" for a pair whose `activeRule` plainly differed.
 * A curated list is the defect under test, and one written here reproduces it faithfully enough to
 * certify the bug as fixed. The guard is what makes a field added later fail loudly instead.
 */
const RULE_FIELDS = ['elementRule', 'armedRule', 'activeRule', 'noJsRule', 'reducedRule', 'nativeRule'];

const markerKeyedCss = (generated) => {
  const escaped = Object.entries(generated)
    .filter(([key, value]) => typeof value === 'string' && value.includes('{') && !RULE_FIELDS.includes(key))
    .map(([key]) => key);
  assert.deepEqual(escaped, [],
    'a CSS rule field exists that this comparison does not cover — add it to RULE_FIELDS, and ' +
      'check whether the marker hash in generate.ts covers it too');
  return [...RULE_FIELDS.map((key) => generated[key]), ...generated.segments.map((s) => s.media)];
};

const generate = (key, value) => {
  const element = dom.window.document.createElement('div');
  const complaints = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = (m) => complaints.push(String(m));
  console.error = (m) => complaints.push(String(m));
  try {
    return { generated: fromAttribute(element, `{ ${KEYFRAMES}, ${key}: ${value} }`), complaints };
  } finally {
    console.warn = warn;
    console.error = error;
  }
};

test('a marker names the same CSS, or different CSS gets a different marker', () => {
  const separating = [];
  let compared = 0;

  for (const def of settings()) {
    const make = VALUES[def.type];
    assert.ok(make, `${def.key}: no value pair for type '${def.type}'. A new setting type needs ` +
      'two valid values here, or every row for it proves nothing');
    const [first, second] = make(def);
    assert.notEqual(first, second, `${def.key}: the two values must differ, or the row is vacuous`);

    const a = generate(def.key, first);
    const b = generate(def.key, second);

    /**
     * REFUSAL IS A FAILURE, NOT A SKIP. A value this file generated that the parser rejects
     * produces two identical no-op parses, which satisfies the biconditional perfectly while
     * testing nothing — the exact shape of silent vacuity. Better to be told the value is wrong.
     */
    assert.deepEqual(a.complaints, [], `${def.key}: the parser refused ${first}`);
    assert.deepEqual(b.complaints, [], `${def.key}: the parser refused ${second}`);
    assert.ok(a.generated && b.generated, `${def.key}: both variants must generate`);

    const cssA = JSON.stringify(markerKeyedCss(a.generated));
    const cssB = JSON.stringify(markerKeyedCss(b.generated));
    /** The marker is IN the CSS it names, so comparing raw text would always differ. Blank it and
     *  the comparison is about the rules, which is the question. */
    const bodyA = cssA.replaceAll(a.generated.hash, '');
    const bodyB = cssB.replaceAll(b.generated.hash, '');

    const sameName = a.generated.hash === b.generated.hash;
    const sameCss = bodyA === bodyB;
    compared++;
    if (!sameCss) separating.push(def.key);

    assert.equal(sameName, sameCss, sameName
      ? `${def.key} changes the generated CSS but not the marker, so two animations share one ` +
        'registry key — the second is discarded and its elements wear the first one\'s rule'
      : `${def.key} does not change the generated CSS but does change the marker, so identical ` +
        'rules are inserted twice under different names');
  }

  assert.equal(compared, settings().length,
    'NON-ZERO CONTROL: every setting in the vocabulary must have been compared');
  assert.ok(separating.length > 0,
    'NON-ZERO CONTROL: no setting changed the generated CSS at all, so the biconditional held ' +
      'vacuously on every row and this suite proved nothing');
});

/**
 * The regression pin, named rather than left to the sweep above. The sweep would catch a
 * reintroduction only while `scroll`'s generated pair still differs; this says out loud which case
 * was the live defect, so a future reader of a red run knows what they broke.
 */
test('scroll — the setting the curated hash missed — separates', () => {
  const a = generate('scroll', "'0 1'");
  const b = generate('scroll', "'0.2 0.8'");
  assert.ok(a.generated && b.generated, 'NON-ZERO CONTROL: both must generate');
  assert.notEqual(a.generated.hash, b.generated.hash,
    'two scroll ranges derived one marker again — the second animation is being discarded');
  assert.notEqual(a.generated.nativeRule, b.generated.nativeRule,
    'CONTROL: the two must actually generate different CSS, or the marker check above is vacuous');
});
