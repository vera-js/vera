/**
 * The motion vocabulary modules, wired: easings, paint, path, sequence,
 * split. Its own file because wiring is module state and the base motion
 * suite asserts the UNWIRED answers (the "needs the easings module"
 * refusal) — one process each, no bleed.
 *
 * jsdom notes: `CSS` is deliberately NOT exposed, so paint's
 * `CSS.supports` guard skips and the accept path is testable; canvas has no
 * 2D context here, which makes sequence's whole validation chain observable
 * through its final refusal.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, motion, presets, easings, paint, path, sequence, split, settled, rejections } =
  await load('directives');
wireDirectives([motion, presets, easings, paint, path, sequence, split]);

const doc = dom.window.document;
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => r()));
const mount = async (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  await settled();
  await frame();
  await frame();
  return host;
};

test('easings wired: a per-property ease is accepted, no refusal, still animates', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: { frames: '0% 0, 100% 1', ease: 'ease-in' } }, ease: 'ease-out' }">x</div>`);
  const el = host.querySelector('div');
  assert.equal(rejections(el).length, 0, 'both ease slots resolved through the module');
  assert.match(el.style.filter, /opacity\(1\)/, 'clamped end, shaped curve or not');
  host.remove();
  await settled();
});

test('paint wired: background animates by slot, written as the authored string', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { background: '0% red, 100% blue' } }">x</div>`);
  const el = host.querySelector('div');
  /** Timeline sits past the end in jsdom, so the LAST slot's string lands. */
  assert.equal(el.style.getPropertyValue('background'), 'blue', 'the slot table round-tripped');
  assert.equal(rejections(el).length, 0);
  host.remove();
  await settled();
});

test('paint refuses the image-sourcing family even where CSS.supports is absent', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { background: '0% red, 100% image-set(&quot;https://evil.test/x&quot; 1x)' } }">x</div>`);
  const el = host.querySelector('div');
  assert.ok(rejections(el).some((r) => r.code === 'motion-bad-value'), 'the fetching value was dropped');
  assert.equal(el.style.getPropertyValue('background'), 'red', 'the clean keyframe survived alone');
  host.remove();
  await settled();
});

test('path wired: a selector matching nothing is refused with which way it failed', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { path: '0% 0, 100% 100' }, path-selector: '#nope' }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-path-selector-bad'), 'refused');
  if (!isProduction) assert.ok(reasons.some((r) => /matched no element/.test(r.message)));
  host.remove();
  await settled();
});

test('path without path-selector says so instead of travelling along nothing', async () => {
  const host = await mount(`<div data-vd-motion="{ keyframes: { path: '0% 0, 100% 100' } }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-path-no-selector'));
  if (!isProduction) assert.ok(reasons.some((r) => /needs path-selector/.test(r.message)));
  host.remove();
  await settled();
});

test('sequence wired: the whole validation chain runs — a real canvas fails at the 2D context here', async () => {
  const host = await mount(
    `<canvas data-vd-motion="{ keyframes: { frame: '0% 0, 100% 10' }, frame-url: '/seq/', frame-count: 10 }"></canvas>`);
  const el = host.querySelector('canvas');
  const reasons = rejections(el);
  /** url passed policy, count parsed — jsdom's context-less canvas is the stop. */
  assert.ok(reasons.some((r) => r.code === 'motion-apply-refused'));
  if (!isProduction) assert.ok(reasons.some((r) => /no 2D context/.test(r.message)), 'reached createSequence');
  host.remove();
  await settled();
});

test('sequence: frame on a non-canvas is the first refusal', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { frame: '0% 0, 100% 10' }, frame-url: '/seq/', frame-count: 10 }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-apply-refused'));
  if (!isProduction) assert.ok(reasons.some((r) => /needs a <canvas>/.test(r.message)));
  host.remove();
  await settled();
});

test('sequence: a cross-origin frame-url is refused by the default policy', async () => {
  const host = await mount(
    `<canvas data-vd-motion="{ keyframes: { frame: '0% 0, 100% 10' }, frame-url: 'https://cdn.example/seq/', frame-count: 10 }"></canvas>`);
  const reasons = rejections(host.querySelector('canvas'));
  assert.ok(reasons.some((r) => r.code === 'motion-apply-refused'), 'same-origin unless the FACTORY allows');
  host.remove();
  await settled();
});

test('split by words: pieces inherit the motion minus stagger, the sentence survives hidden', async () => {
  const host = await mount(
    `<p data-vd-split="words" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, stagger: '10%' }">quick brown fox</p>`);
  const p = host.querySelector('p');
  const pieces = [...p.querySelectorAll('[data-vd-motion]')];
  assert.equal(pieces.length, 3, 'three words, three pieces');
  for (const piece of pieces) {
    assert.equal(piece.getAttribute('aria-hidden'), 'true');
    assert.match(piece.getAttribute('data-vd-motion'), /opacity/, 'the animation travelled');
    assert.doesNotMatch(piece.getAttribute('data-vd-motion'), /stagger/, 'the stagger stayed on the host');
    assert.match(piece.style.filter, /opacity\(/, 'and each piece ANIMATES through the engine');
  }
  /**
   * THE CASCADE, observed: the host's stagger shifts each piece's keyframes
   * by index × 10%, so at one fixed timeline position the pieces sit at
   * DIFFERENT values — which is the entire point of splitting, asserted as
   * inequality rather than as any particular number.
   */
  const distinct = new Set(pieces.map((piece) => piece.style.filter));
  assert.ok(distinct.size > 1, `the pieces cascade: ${[...distinct].join(' | ')}`);
  assert.match(p.textContent, /quick brown fox/, 'the readable sentence survives');
  const copy = [...p.querySelectorAll('span')].find((span) => !span.hasAttribute('aria-hidden'));
  assert.ok(copy && /quick brown fox/.test(copy.textContent), 'as the visually-hidden copy');
  host.remove();
  await settled();
});

test('split refuses nested markup and comments by name, and leaves the text alone', async () => {
  const host = await mount(
    `<p id="m" data-vd-split="words" data-vd-motion="fade">has <strong>bold</strong></p>
     <p id="c" data-vd-split="chars" data-vd-motion="fade">has <!-- anchor --> comment</p>`);
  /** Two codes, not one with the word as an argument: the word WAS the prose, so passing it kept
   *  the strings in the production bundle the diagnostics table exists to empty. */
  for (const [id, kind, code] of [['m', 'nested markup', 'split-has-markup'], ['c', 'comments', 'split-has-comments']]) {
    const p = host.querySelector(`#${id}`);
    const reasons = rejections(p);
    assert.ok(reasons.some((r) => r.code === code), `${id} refused`);
    if (!isProduction) assert.ok(reasons.some((r) => r.message.includes(kind)), `named ${kind}`);
    assert.equal(p.querySelectorAll('span').length, 0, 'nothing was rewritten');
  }
  host.remove();
  await settled();
});

test('split teardown puts the original text back exactly', async () => {
  const host = await mount(
    `<p data-vd-split="chars" data-vd-motion="fade">abc</p>`);
  const p = host.querySelector('p');
  assert.ok(p.querySelectorAll('[data-vd-motion]').length >= 3, 'split happened');
  p.removeAttribute('data-vd-split');
  await settled();
  assert.equal(p.textContent, 'abc', 'the engine teardown restored the sentence');
  host.remove();
  await settled();
});

test('a split container does not animate as a block — its value is the template', async () => {
  const host = await mount(
    `<p data-vd-split="words" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }">one two</p>`);
  const p = host.querySelector('p');
  assert.equal(p.style.filter, '', 'the container itself carries no animation style');
  host.remove();
  await settled();
});
