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
 * **`@property` does NOT scope the same way, which is the other half of this file.** A registration in
 * a document stylesheet reaches shadow elements in all three engines. Two at-rules that both register
 * a name, scoping differently — so the write path delivers keyframes per root because it must, and
 * registers `--p` once for the document because it may.
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

/* ── @property registration: the same question, for the other half of the write path ─────────── */

/**
 * **Transitioning a custom property requires it to be REGISTERED with a numeric syntax.** An
 * unregistered custom property is a token stream — it flips at the midpoint rather than
 * interpolating — so the whole "one variable, transitioned" design rests on registration working
 * where the element is.
 *
 * Two ways to register, and they may not scope alike: `@property` in a stylesheet, and
 * `CSS.registerProperty()`, a document-global JS call that throws on a duplicate name. Since
 * `@keyframes` turned out to be tree-scoped in two engines out of three, this is measured rather
 * than assumed.
 */
const NUM = '--probe-p';

/** Registered and interpolable → a mid transition value. Unregistered → it jumps, no mid value. */
const readsInterpolated = async (el) => {
  el.style.setProperty(NUM, '0');
  el.style.transition = `${NUM} 1s linear`;
  /**
   * **A forced style resolution, not a frame.** A transition needs two RESOLVED values, and every
   * rAF callback in a turn runs before the same paint — so awaiting a frame between the two writes
   * starts no transition at all. Measured the hard way: without this, nothing interpolated in
   * Chromium or Firefox and the probe reported "@property does not work" about its own bug.
   */
  void getComputedStyle(el).getPropertyValue(NUM);
  el.style.setProperty(NUM, '1');
  await new Promise((r) => setTimeout(r, 120));
  const value = Number(getComputedStyle(el).getPropertyValue(NUM));
  return value > 0 && value < 1;
};

it('CONTROL: an UNREGISTERED custom property does not interpolate', async () => {
  const el = makeHost();
  expect(await readsInterpolated(el),
    'without this control, every case below could pass on a property that was never transitioning').to.equal(false);
});

it('@property in a document stylesheet registers for the document', async () => {
  inDocument(`@property ${NUM} { syntax: '<number>'; inherits: false; initial-value: 0 }`);
  const el = makeHost();
  expect(await readsInterpolated(el), 'a registered number interpolates').to.equal(true);
});

it('a document @property registration DOES reach a shadow element — all three engines', async () => {
  inDocument(`@property ${NUM} { syntax: '<number>'; inherits: false; initial-value: 0 }`);
  const host = makeHost();
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<div id="t">x</div>`;
  const reached = await readsInterpolated(root.getElementById('t'));

  /**
   * **The asymmetry, and it is the finding.** `@keyframes` and `@property` are both at-rules that
   * register a name, and they do NOT scope alike: keyframes are tree-scoped in two engines of three,
   * while a property registration crosses into shadow trees in all three. Anyone reasoning from one
   * to the other — as I did — gets it backwards.
   *
   * So the generated write path splits: keyframes are delivered PER ROOT because they must be, and
   * `--p` is registered ONCE for the document because it may be.
   */
  expect(reached, `document @property reached a shadow element: ${reached}`).to.equal(true);
});

it('CSS.registerProperty() throws on a duplicate name', async () => {
  const name = `--probe-dup-${Math.random().toString(36).slice(2)}`;
  const once = () => CSS.registerProperty({ name, syntax: '<number>', inherits: false, initialValue: '0' });
  once();
  /**
   * The trap that comes WITH content hashing: identical animations want the same property name, so
   * the second registration is exactly the case that throws. A `Set` of registered names, not a bare
   * try/catch — which would also swallow real errors.
   */
  let threw = false;
  try { once(); } catch { threw = true; }
  expect(threw, 'a duplicate registration is an error, not a no-op').to.equal(true);
});
