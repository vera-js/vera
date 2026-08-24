/**
 * The list of members a real DOM exposes, taken from the engine rather than from memory.
 *
 * `@verajs/ssr`'s server DOM was extended reactively for its whole life — `dispatchEvent`,
 * `classList`, `dataset`, `append`, `attributeChangedCallback` and sixty reflected properties were
 * each found by someone tripping over the one that was missing. `tests/dom-surface.mjs` is the
 * surface these engines actually expose, and `tests/ssr-dom-surface.test.mjs` holds the shim to it;
 * this suite is what keeps that data honest as browsers change.
 *
 * A failure here is not a bug — it is an engine adding a member. Read the names, then update
 * `tests/dom-surface.mjs`: each one is either implemented in the shim or listed as out of scope
 * with the reason it cannot work on a server.
 */
import { expect } from '@esm-bundle/chai';
import { SURFACES } from '../dom-surface.mjs';

/** Event handlers are excluded: there are hundreds, they are all `on*`, and none reach markup. */
const names = (...prototypes) => {
  const members = new Set();
  for (const proto of prototypes)
    for (const name of Object.getOwnPropertyNames(proto))
      if (name !== 'constructor' && !name.startsWith('on')) members.add(name);
  return [...members].sort();
};

const ACTUAL = {
  element: () => names(HTMLElement.prototype, Element.prototype, Node.prototype, EventTarget.prototype),
  shadowRoot: () =>
    names(ShadowRoot.prototype, DocumentFragment.prototype, Node.prototype, EventTarget.prototype),
  document: () => names(Document.prototype, Node.prototype, EventTarget.prototype),
  sheet: () => names(CSSStyleSheet.prototype),
};

for (const [kind, actual] of Object.entries(ACTUAL)) {
  it(`the checked-in ${kind} surface still matches this engine`, () => {
    /**
     * Asymmetric on purpose. A member this engine has and the list does not is a gap in our
     * coverage and must fail. A member the list has and this engine does not is another engine's —
     * the list is the union across all three — so it is not this suite's business.
     */
    const missing = actual().filter((name) => !SURFACES[kind].includes(name));
    expect(missing, `not in tests/dom-surface.mjs — add them, then implement or scope them out`).to.deep.equal([]);
  });
}
