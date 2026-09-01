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

/** A capitalised function with a prototype: an interface, covered by rule rather than by list. */
const isConstructor = (name) =>
  /^[A-Z]/.test(name) && typeof window[name] === 'function' && window[name].prototype !== undefined;

/**
 * Globals this test runner puts on the page, which are not the platform and must not become part of
 * the recorded surface: `@web/test-runner`'s own channel, Mocha's BDD functions, and the `gc` hook
 * that `--js-flags=--expose-gc` adds for the memory suite. A list rather than a pattern, because
 * `before`, `context` and `run` are plausible platform names and a pattern broad enough to catch
 * them would hide a real one.
 */
const HARNESS = new Set([
  '__WDS_WEB_SOCKET__', '__WTR_CONFIG__', '__WTR_MOCHA_RUNNER__', '__wtr_browser_logs__',
  'after', 'afterEach', 'before', 'beforeEach', 'context', 'describe', 'it', 'mocha', 'run',
  'specify', 'xcontext', 'xdescribe', 'xit', 'xspecify', 'gc',
]);

const ACTUAL = {
  element: () => names(HTMLElement.prototype, Element.prototype, Node.prototype, EventTarget.prototype),
  shadowRoot: () =>
    names(ShadowRoot.prototype, DocumentFragment.prototype, Node.prototype, EventTarget.prototype),
  document: () => names(Document.prototype, Node.prototype, EventTarget.prototype),
  sheet: () => names(CSSStyleSheet.prototype),
  /**
   * `classList` was listed as a member of the element and then never looked inside, which is how
   * `replace` came to be missing: the surface check passed on the *property* while the object it
   * returned was three methods short. `CSSStyleDeclaration` is deliberately not here — the shim's
   * `style` is a proxy that answers any name, so enumerating its seven hundred CSS properties would
   * assert nothing. That one is covered behaviourally instead.
   */
  tokenList: () => names(DOMTokenList.prototype),
  /**
   * **The window is enumerated from the global object, not from `Window.prototype`** — that
   * prototype is empty in every engine, because window's members are its own properties.
   *
   * Constructors are excluded and covered by a rule instead (`tests/ssr-dom-surface.test.mjs`
   * asserts every interface the shim implements is exposed so `instanceof` answers). There are
   * about seven hundred of them and listing each with its own reason would bury the hundred and
   * fifty names that describe what a window actually *does*.
   */
  window: () => names(window).filter((name) => !isConstructor(name) && !HARNESS.has(name)),
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
