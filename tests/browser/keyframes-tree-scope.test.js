/**
 * **Where does an element look up an `@keyframes` name — its own tree, the document, or both?**
 *
 * A platform recording, in the same spirit as `spread-names.test.js`: it asserts what the ENGINES do,
 * not what this framework does, because a design decision rests on the answer and reasoning about it
 * is how the same question was got wrong twice already elsewhere.
 *
 * **The engines disagree, and that IS the finding** (measured 2026-09-09, all three):
 *
 *   | a shadow element referencing a name defined in the document | |
 *   | --- | --- |
 *   | Chromium | unresolved (1) — no fallback |
 *   | Firefox  | unresolved (1) — no fallback |
 *   | WebKit   | RESOLVED (0.6) — falls back |
 *
 * So neither behaviour can be relied on. A generated stylesheet emitted once in the head would work
 * in WebKit and silently do nothing in Chromium and Firefox — for a framework whose normal case is
 * shadow DOM, that is a bug a user finds, not us. **The sheet must be emitted into the tree that uses
 * it**, which is forced rather than chosen, and is what the load-bearing test below pins.
 *
 * The divergent case is deliberately NOT asserted. An assertion that passes for both answers asserts
 * nothing, and the fallback may converge in either direction later without our design caring — what
 * must never change is that a name defined in an element's OWN root resolves, everywhere.
 *
 * Measured by seeking a paused animation to its midpoint and reading the computed value. A resolved
 * name gives the interpolated value; an unresolved one leaves the element at its natural value, which
 * is the control every case here needs.
 */
import { expect } from '@esm-bundle/chai';

const MID = 'omni-probe-keyframes';
const RULE = `@keyframes ${MID} { from { opacity: 0.2 } to { opacity: 1 } }`;
/** Paused and seeked to the midpoint: a resolved name reads ~0.6, an unresolved one reads 1. */
const SEEK = `animation: ${MID} 1s linear both paused; animation-delay: -0.5s;`;

const hosts = [];
const makeHost = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  return host;
};
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  for (const style of [...document.head.querySelectorAll('style[data-probe]')]) style.remove();
});

const inDocument = (css) => {
  const style = document.createElement('style');
  style.setAttribute('data-probe', '');
  style.textContent = css;
  document.head.appendChild(style);
};

const opacityOf = (el) => Number(getComputedStyle(el).opacity);

it('CONTROL: a name defined and used in the same document scope resolves', async () => {
  inDocument(RULE);
  const el = makeHost();
  el.style.cssText = SEEK;
  await new Promise((r) => requestAnimationFrame(r));

  const value = opacityOf(el);
  expect(value, 'the probe measures something: seeking a resolved name gives a mid value').to.be.below(0.95);
  expect(value).to.be.above(0.2);
});

it('CONTROL: an UNDEFINED name leaves the element at its natural value', async () => {
  const el = makeHost();
  el.style.cssText = SEEK;
  await new Promise((r) => requestAnimationFrame(r));

  /** Without this, "did not animate" and "animated to 1" would be indistinguishable above. */
  expect(opacityOf(el), 'no rule anywhere: nothing resolved').to.equal(1);
});

it('THE RULE: a shadow root defines the name for its own elements, in every engine', async () => {
  const host = makeHost();
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${RULE}</style><div id="t" style="${SEEK}">x</div>`;
  await new Promise((r) => requestAnimationFrame(r));

  /**
   * The one thing all three agree on, and therefore the only thing a design may rest on: emit the
   * sheet into the tree that uses it. Everything else here is context for why that is not a choice.
   */
  const value = opacityOf(root.getElementById('t'));
  expect(value, `own-root keyframes resolve: ${value}`).to.be.below(0.95);
  expect(value, 'and to a real interpolated value, not zero').to.be.above(0.2);
});

it('a name defined INSIDE a shadow root does not leak out to the document', async () => {
  const host = makeHost();
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${RULE}</style><div>x</div>`;

  const outside = makeHost();
  outside.style.cssText = SEEK;
  await new Promise((r) => requestAnimationFrame(r));

  expect(opacityOf(outside), 'a shadow tree registers its keyframes for itself only').to.equal(1);
});


