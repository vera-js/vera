/**
 * The list of members a real element has, taken from the engine rather than from memory.
 *
 * `@verajs/ssr`'s server DOM has been extended reactively for its whole life — `dispatchEvent`,
 * `classList`, `dataset`, `append`, `attributeChangedCallback` and sixty reflected properties were
 * each found by someone tripping over the one that was missing. `tests/dom-surface.mjs` is the
 * checked-in surface those engines actually expose, and `tests/ssr-dom-surface.test.mjs` holds the
 * shim to it; this suite is what keeps that data honest as browsers change.
 *
 * A failure here is not a bug — it is an engine adding or removing a member. Read the diff, then
 * update `tests/dom-surface.mjs`: a new member is either implemented in the shim or listed as out
 * of scope with a reason.
 */
import { expect } from '@esm-bundle/chai';
import { SURFACE } from '../dom-surface.mjs';

/** Event handlers are excluded: there are hundreds, they are all `on*`, and none reach markup. */
const surfaceOf = (window) => {
  const members = new Set();
  for (const proto of [
    window.HTMLElement.prototype,
    window.Element.prototype,
    window.Node.prototype,
    window.EventTarget.prototype,
  ])
    for (const name of Object.getOwnPropertyNames(proto)) if (name !== 'constructor' && !name.startsWith('on')) members.add(name);
  return [...members].sort();
};

it('the checked-in element surface still matches this engine', () => {
  const actual = surfaceOf(window);
  /**
   * Asymmetric on purpose. A member this engine has and the list does not is a gap in our coverage
   * and must fail. A member the list has and this engine does not is another engine's — the list is
   * the union across all three — so it is not this suite's business.
   */
  const missing = actual.filter((name) => !SURFACE.includes(name));
  expect(missing, `not in tests/dom-surface.mjs — add them, then implement or scope them out`).to.deep.equal([]);
});
