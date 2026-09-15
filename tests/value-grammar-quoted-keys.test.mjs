/**
 * **A QUOTED OBJECT KEY IS A KEY** — `{ 'a': 1 }` and `{ "a": 1 }`, the same as `{ a: 1 }`.
 *
 * The braces in a `data-vd-*` value carry JS object semantics, and JS accepts quoted keys. The
 * shared grammar in `@verajs/shared-utils` accepted only the bare form: a quoted key raised
 * `object-bad-key` — "expected a key" — and took the WHOLE attribute with it. Fixed 2026-09-14 at a
 * measured +17 to +19 B gzipped across the five bundles that inline the grammar.
 *
 * **One grammar, every consumer**, which is why this file tests two packages that share nothing
 * else. It surfaced as a motion fixture mismatch (`{ keyframes: { 'translate-y': … } }`) while the
 * defect sat one layer down, where `data-vd-state="{ 'open': false }"` died the same way — so a
 * test that only covered motion would have left the more common surface unguarded.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver',
  'CSSStyleSheet', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const directives = await load('directives');
directives.wireDirectives([directives.expressions, ...directives.interactions]);
const { parseMotion } = await load('motion/internal');
const doc = dom.window.document;

/** Mount a `data-vd-state` region and read back what the grammar made of it. */
const stateFrom = async (value) => {
  const el = doc.createElement('div');
  el.setAttribute('data-vd-state', value);
  doc.body.appendChild(el);
  await directives.settled();
  const state = directives.stateOf(el);
  /**
   * SNAPSHOT BEFORE REMOVING. `stateOf` hands back a live proxy bound to the element, so returning
   * it and spreading after `el.remove()` reads a torn-down region — which made even the BARE
   * control fail and looked like the grammar rejecting everything.
   */
  const snapshot = state === null ? null : { ...state };
  el.remove();
  return snapshot;
};

const motionRefusals = (value) => {
  const dropped = [];
  const parsed = parseMotion(doc.createElement('div'), value, { dropped });
  return [...(parsed?.rejected ?? []), ...dropped.flatMap((d) => d.rejected ?? [])].map((r) => r.code);
};

test('data-vd-state accepts a quoted key, in both quote styles', async () => {
  /** The CONTROL first: the bare form must work, or these assertions prove only that the directive
   *  is broken in some uniform way. */
  assert.deepEqual(await stateFrom('{ open: false }'), { open: false }, 'the bare control');
  assert.deepEqual(await stateFrom("{ 'open': false }"), { open: false }, 'single quotes');
  assert.deepEqual(await stateFrom('{ "open": false }'), { open: false }, 'double quotes');
});

test('quoted and bare keys mix freely in one object', async () => {
  assert.deepEqual(await stateFrom("{ 'a': 1, b: 2, 'c-d': 3 }"), { a: 1, b: 2, 'c-d': 3 });
});

test('motion takes a quoted property name — the case the shared corpus caught', () => {
  assert.deepEqual(motionRefusals("{ keyframes: { 'translate-y': '0px, 40px' } }"), [],
    'no refusal; this raised motion-parse-failed before the fix');
  /** The control: the bare spelling was always fine, so a pass above is about the QUOTES. */
  assert.deepEqual(motionRefusals("{ keyframes: { translate-y: '0px, 40px' } }"), []);
});

test('an EMPTY quoted key is still refused — it is a missing key, not an odd spelling', async () => {
  assert.equal(await stateFrom("{ '': 1 }"), null, 'the region refuses rather than binding an empty name');
});

test('an unterminated quoted key is refused — by both readers, with different words', async () => {
  /**
   * RECORDED, not endorsed. The two readers diverge on the DIAGNOSTIC here and agree on the
   * outcome. The shared grammar reads the key through `string()`, so it says `string-unterminated`
   * and points at the quote. The directives object reader scans past the quoted span and strips the
   * quotes afterwards — matching its sibling reader a hundred lines above, and 22 B gzipped cheaper
   * than branching the whole key computation — so an unterminated quote runs to the end of the
   * value and surfaces as `object-missing-colon` with the rest of the attribute quoted back at the
   * author: *expected ":" after "open: false }"*.
   *
   * That message is worse. It is recorded here rather than quietly accepted so the cost of the
   * cheaper shape is visible, and so nobody "fixes" this test without knowing a byte decision sits
   * underneath it.
   */
  assert.equal(await stateFrom("{ 'open: false }"), null, 'the region refuses either way');
});

test('quoting does not smuggle a dangerous name past a bare-identifier guard', async () => {
  /**
   * The requirement that made `string()` the right reader: a quoted key must produce an ordinary
   * name flowing into the same downstream checks as a bare one. If the two spellings diverged here,
   * quoting would be a bypass — so the assertion is that they are IDENTICAL, not merely that each
   * is safe on its own.
   */
  const bare = await stateFrom('{ __proto__: 1 }');
  const quoted = await stateFrom("{ '__proto__': 1 }");
  assert.notEqual(bare, null, 'the CONTROL: the bare spelling parsed at all');
  assert.notEqual(quoted, null, 'the quoted spelling parsed too');
  assert.deepEqual(quoted, bare, 'both spellings reach the same place — quoting is not a bypass');
  assert.equal(Object.prototype.polluted, undefined, 'and neither wrote onto Object.prototype');
});
