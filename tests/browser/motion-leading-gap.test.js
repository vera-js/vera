/**
 * **A missing `0%`/`100%` keyframe comes from the ELEMENT'S OWN VALUE, and vera relies on it.**
 *
 * Per CSS Animations, a list with no `0%` frame has that frame constructed from the element's
 * underlying computed value. That is not an edge case here — it is the mechanism the **lone-value
 * shorthand** is built on: `opacity: '0.2'` compiles to a single `100%` frame and animates TO 0.2
 * from wherever the element already is. Anything that synthesises the missing end instead turns
 * that shorthand into a constant.
 *
 * This file used to assert the opposite. A padding step gave every emitted list explicit `0%` and
 * `100%` frames holding the first and last authored values, on the reasoning that a list starting
 * past `0%` should not interpolate from the element's own state — and these tests pinned it. It was
 * reverted on 2026-09-14: a lone value is ITSELF a list that does not reach `0%`, so the padding
 * emitted `0% 0.2, 100% 0.2` and the element never moved. The rule below is the platform's, and the
 * documented API rests on it (`packages/directives/README.md`, `llms.txt`).
 *
 * **This lives in the browser suite because it cannot be asked anywhere else.** The observable is a
 * COMPUTED value mid-interpolation; jsdom computes no animation, so a node-side probe would read
 * the declared value and certify either rule as working.
 */
import { expect } from '@esm-bundle/chai';

/** What the compiler emits for `opacity: '0.2'` — ONE frame, no synthesized `0%`. */
const LONE = `@keyframes lone-value { 100% { filter: opacity(0.2) } }`;
/** And for `'50% 0, 80% 1'` — the authored frames alone. */
const GAPPED = `@keyframes gapped { 50% { filter: opacity(0) } 80% { filter: opacity(1) } }`;
/** The control: a list that DOES reach both ends, which must not depend on the element at all. */
const SPANNING = `@keyframes spanning { 0% { filter: opacity(0) } 100% { filter: opacity(1) } }`;

const sheet = document.createElement('style');
sheet.textContent = `${LONE}\n${GAPPED}\n${SPANNING}`;
document.head.appendChild(sheet);

/**
 * Park a paused animation at progress `p` and read what the engine computes there.
 * `underlying` is the element's own filter — the value CSS must reach for when a frame is missing.
 */
const opacityAt = (name, p, underlying = 'opacity(1)') => {
  const element = document.createElement('div');
  element.style.filter = underlying;
  element.style.animation = `${name} 1s linear both paused`;
  element.style.animationDelay = `${-p}s`;
  document.body.appendChild(element);
  const read = getComputedStyle(element).filter;
  element.remove();
  return read;
};

/** `opacity(0)` serialises differently across engines; compare the NUMBER. */
const amount = (filter) => {
  const m = /opacity\(([\d.]+)\)/.exec(filter);
  return m ? Number(m[1]) : Number.NaN;
};

it('THE LONE VALUE MOVES — a single 100% frame animates from the element, not from itself', () => {
  /** The regression this file exists to catch: with a synthesized `0%` both reads are 0.2 and the
   *  element is a constant. The spread between them is the whole behaviour. */
  expect(amount(opacityAt('lone-value', 0)), 'p=0 is the element’s own value').to.be.closeTo(1, 0.02);
  expect(amount(opacityAt('lone-value', 0.5)), 'p=.5 is halfway to 0.2').to.be.closeTo(0.6, 0.05);
  expect(amount(opacityAt('lone-value', 1)), 'p=1 is the authored value').to.be.closeTo(0.2, 0.02);
});

it('and it animates from WHATEVER the element is, not from a fixed start', () => {
  /** Proves the source is genuinely the element rather than a constant that happens to be 1 — with
   *  a different underlying value every reading before the end must move with it. */
  expect(amount(opacityAt('lone-value', 0, 'opacity(0.6)')), 'p=0 tracks the element')
    .to.be.closeTo(0.6, 0.02);
  expect(amount(opacityAt('lone-value', 0.5, 'opacity(0.6)')), 'p=.5 is halfway from 0.6 to 0.2')
    .to.be.closeTo(0.4, 0.05);
});

it('a list starting past 0% reads the element’s own value at p=0', () => {
  expect(amount(opacityAt('gapped', 0)), 'no 0% frame, so CSS uses the element').to.be.closeTo(1, 0.02);
  expect(amount(opacityAt('gapped', 0.25)), 'p=.25 is mid-interpolation toward the 50% frame')
    .to.be.closeTo(0.5, 0.05);
  expect(amount(opacityAt('gapped', 0.5)), 'p=.5 is the first authored frame').to.be.closeTo(0, 0.02);
  expect(amount(opacityAt('gapped', 0.9)), 'past the last frame it holds').to.be.closeTo(1, 0.02);
});

it('THE CONTROL: a list reaching both ends ignores the element entirely', () => {
  /** Without this, every assertion above would also pass on an engine that simply ignored
   *  `animation` and reported the inline filter throughout. */
  expect(amount(opacityAt('spanning', 0, 'opacity(0.6)')), 'an explicit 0% wins over the element')
    .to.be.closeTo(0, 0.02);
  expect(amount(opacityAt('spanning', 0.5, 'opacity(0.6)')), 'and the span interpolates normally')
    .to.be.closeTo(0.5, 0.05);
});
