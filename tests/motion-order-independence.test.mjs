/**
 * **Nothing may depend on the order component roots activate — because that order is unknowable.**
 *
 * This is a requirement, not an observation, and the distinction matters: there is no version of
 * this system in which the order can be pinned down and relied on.
 *
 * - The SERVER registers a component root on the `'settle'` insert, during a document-order render.
 * - The CLIENT registers one on `'init'`, which fires at CUSTOM ELEMENT UPGRADE.
 * - Upgrade order is `customElements.define` order, not document position. Measured: a document holding
 *   `x-a` then `x-b` whose module defines `x-b` first upgrades `x-b` first. Two imports in the other
 *   sequence is all it takes.
 * - And with `@verajs/autoloader` the definition itself is `await import(src)`, triggered when an
 *   element enters the DOM. So upgrade order is MODULE RESOLUTION order — network latency, cache
 *   state, connection multiplexing. **Two loads of the same page in the same browser can differ
 *   from each other**, never mind from the server.
 *
 * So the invariant cannot be "the two sides walk alike". It has to be that walking differently
 * changes nothing.
 *
 * **Today it changes nothing, and this exists so that stays true.** Rule insertion order is the
 * one thing root order decides, and the cascade is safe from it: the order-sensitive triple
 * (base, active, no-JS) is acquired consecutively for ONE element, while rules belonging to
 * different elements carry different hashes in their selectors and never tie on specificity.
 *
 * The hazard is what gets added next. An adaptive rule name — *"on a collision the second body
 * escapes to a wider hash"* — was designed, built and measured before being withdrawn precisely
 * here: a stateful name is order-dependent, so two sides would derive DIFFERENT names for the same
 * body and a short name would mean a different animation on each. That is the SSR-boundary version
 * of the very defect the adaptive design set out to fix. This suite is what fails the next time
 * something reaches for state at naming time.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

/**
 * Bodies chosen because they COLLIDE under the 32-bit content hash — found by search, from 474,782
 * candidates. A non-colliding pair would pass under any scheme, stateful or not, and the suite
 * would be asserting nothing.
 */
const LEFT = 'r7wzx';
const RIGHT = 'ra6cd';

/**
 * FNV-1a 32, stated HERE as the spec rather than imported — the precondition must not be
 * established by the function under test. The first draft asserted the collision by calling
 * `contentHash` twice, so a stateful implementation broke the PREMISE before the order assertion
 * could run: the suite went red for the right defect and named the wrong thing, which sends
 * whoever reads it to fix a control rather than the state.
 */
const fnv1a32 = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

test('a rule name is a function of its content, never of what was named before it', async () => {
  /** Two independent module instances, so each carries its own registry state. The query string is
   *  what makes the second import a separate module rather than a cache hit. */
  const first = await load('motion', '?order=left-first');
  const second = await load('motion', '?order=right-first');

  assert.equal(
    fnv1a32(LEFT),
    fnv1a32(RIGHT),
    'NON-ZERO CONTROL: these bodies must actually collide under the content hash SPEC, or order ' +
      'could not matter for them and this suite would pass for a reason unrelated to what it tests'
  );

  /** One instance meets LEFT first; the other meets RIGHT first. */
  const leftFirst = { left: first.contentHash(LEFT), right: first.contentHash(RIGHT) };
  const rightFirst = { right: second.contentHash(RIGHT), left: second.contentHash(LEFT) };

  assert.equal(leftFirst.left, rightFirst.left,
    'the name for one body changed with when it was first seen. The server and the client walk ' +
      'roots in different orders, and under the autoloader two page loads do too — so a ' +
      'name that depends on order means a name that means different animations in different runs');
  assert.equal(leftFirst.right, rightFirst.right, 'and the same for the other body');
});
