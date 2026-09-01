/**
 * Values that misbehave when the renderer coerces them.
 *
 * `fault-injection` covers **your callbacks** throwing — an effect, a cleanup, a ref, a template
 * function. This is the other direction: a *value* that throws when the renderer touches it, which
 * raises from **inside** the commit rather than from user code the renderer called.
 *
 * None of these is exotic. `state.user` holding a Proxy from a data layer, a getter that throws once
 * a session expires, a `Symbol` arriving from a typo, an object from `JSON.parse` with a null
 * prototype — each reaches a binding as an ordinary value and gets stringified somewhere.
 *
 * ## The invariant is recovery, not success
 *
 * A value whose `toString` throws *should* propagate: the caller's data is broken and hiding that
 * would be worse. What must not happen is the framework being left unusable. So every case renders
 * the poisoned value, then renders a good one **at the same call site**, and compares against a fresh
 * host — a renderer that reports a bad value and then quietly stops updating is indistinguishable
 * from one that works, until it matters.
 *
 * The comparison is against a fresh render rather than a literal, so it stays correct if the shapes
 * change.
 *
 * ## Why the recovery holds, established by mutation
 *
 * Three attempts to break it failed, and what they ruled out is more informative than a kill would
 * have been:
 *
 * - Marking the part committed *before* the write — recovery still lands, because the good value
 *   differs from the poisoned one and commits anyway.
 * - Nulling the part's text node when a commit throws — **the mutation was confirmed reached** and
 *   recovery still landed: a part with no text node **rebuilds it** rather than failing.
 * - The root part is registered before the commit (`renderer.ts`), so a failed render does leave one
 *   behind; the resilience is not "start over from nothing".
 *
 * So the property does not rest on a part surviving a throw intact. That is worth knowing, because
 * the obvious assumption — a failed render leaves nothing registered — is **false**, and the file
 * above it already records a defect from that class: a `<select>.value` stranded in a queue by a
 * throw and handed to the *next* render, which is why that flush is in a `finally`.
 *
 * ## What was checked and deliberately not changed
 *
 * The messages. A user's own error arrives verbatim — their message, their stack, no framework noise.
 * A `Symbol` gets the platform's message naming both the symbol and the DOM call. A null-prototype
 * object gets `Cannot convert object to primitive value`, which names nothing — but it is **exactly**
 * what plain JavaScript gives for the same coercion, so the framework is not degrading it. That is
 * the distinction Defect 34 turned on: there, wrapping made the diagnosis *worse* than no framework
 * at all. Here it does not, and naming the template position would mean a `try`/`catch` around every
 * coercion on the hottest path to improve on what the platform already says.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent',
])
  globalThis[key] = dom.window[key];

const { html } = await load('core');
const { renderInto } = await load('renderer');
const D = dom.window.document;

/** Values that fight back, and values that merely look unusual. */
const POISONED = {
  'toString throws': () => ({ toString() { throw new Error('toString-boom'); } }),
  'valueOf and toString throw': () => ({ valueOf() { throw new Error('v'); }, toString() { throw new Error('t'); } }),
  'Symbol.toPrimitive throws': () => ({ [Symbol.toPrimitive]() { throw new Error('primitive-boom'); } }),
  'a Symbol': () => Symbol('sym'),
  'an object holding a Symbol': () => ({ s: Symbol('inner') }),
  'a proxy that throws on get': () => new Proxy({}, { get() { throw new Error('proxy-boom'); } }),
  'a getter that throws': () => Object.defineProperty({}, 'anything', { get() { throw new Error('getter-boom'); }, enumerable: true }),
  'a cyclic object': () => { const o = { name: 'cycle' }; o.self = o; return o; },
  'a null-prototype object': () => Object.assign(Object.create(null), { x: 1 }),
  'a very long string': () => 'x'.repeat(100_000),
  'a BigInt': () => 10n ** 20n,
  'NaN': () => NaN,
  'negative zero': () => -0,
  'a Date': () => new Date(0),
  'a function': () => function named() {},
  'a promise nobody awaits': () => Promise.resolve('later'),
};

/** Positions where a value gets coerced. `?disabled` only tests truthiness, so it coerces nothing. */
const POSITIONS = {
  'child text': (v) => html`<p>${v}</p>`,
  'attribute': (v) => html`<p title=${v}>t</p>`,
  'property': (v) => html`<input .value=${v}>`,
  'boolean': (v) => html`<input ?disabled=${v}>`,
  'in a list': (v) => html`<ul>${[v].map((x) => html`<li>${x}</li>`)}</ul>`,
};

const readBack = (host) =>
  `${host.textContent}|${host.querySelector('p,input,li')?.getAttribute?.('title') ?? ''}`;

test('a value the renderer cannot coerce never leaves the framework unusable', () => {
  const stuck = [];
  let cases = 0;
  let threw = 0;

  for (const [positionName, build] of Object.entries(POSITIONS)) {
    for (const [valueName, make] of Object.entries(POISONED)) {
      cases++;
      const host = D.createElement('div');

      const originalWarn = console.warn;
      console.warn = () => {};
      try {
        renderInto(build(make()), host);
      } catch {
        threw++;
      } finally {
        console.warn = originalWarn;
      }

      /** The same call site, with an ordinary value. This is the part that matters. */
      let after;
      try {
        renderInto(build('recovered'), host);
        after = readBack(host);
      } catch (error) {
        stuck.push(`${positionName} / ${valueName}: the next good render threw ${error.constructor.name}: ${String(error.message).slice(0, 70)}`);
        continue;
      }

      /** What a host that never saw the bad value renders — the oracle for "still correct". */
      const fresh = D.createElement('div');
      renderInto(build('recovered'), fresh);
      const expected = readBack(fresh);

      if (after !== expected)
        stuck.push(`${positionName} / ${valueName}\n      after the bad value: ${JSON.stringify(after.slice(0, 80))}\n      a fresh render:      ${JSON.stringify(expected.slice(0, 80))}`);
    }
  }

  assert.equal(cases, Object.keys(POSITIONS).length * Object.keys(POISONED).length, 'not every combination ran');
  /**
   * Some of these *must* throw, or the corpus has stopped being poisonous — a Symbol cannot become a
   * string and the framework should not pretend otherwise. This asserts the fuzz still has teeth.
   */
  assert.ok(threw >= 10, `only ${threw} of ${cases} threw — the poisoned values are no longer poisonous`);
  assert.deepEqual(
    stuck.slice(0, 8),
    [],
    `${stuck.length} of ${cases} left the renderer unable to recover:\n\n  ${stuck.slice(0, 8).join('\n\n  ')}`
  );
});

test("a user's own error arrives verbatim rather than wrapped", () => {
  /**
   * The reason this is worth pinning: the value's failure is the caller's, and their message and
   * stack are more use than anything the framework could say about it. Wrapping would replace a
   * message that names their data with one that names ours.
   */
  const host = D.createElement('div');
  const mine = new Error('my data is broken');
  assert.throws(
    () => renderInto(html`<p>${{ toString() { throw mine; } }}</p>`, host),
    (error) => error === mine,
    'the error reaching the caller was not the one their value threw'
  );
});
