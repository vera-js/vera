/**
 * Pointer as a timeline source — the SPEC's jsdom-provable fixtures: the rest pose (jsdom's
 * matchMedia never matches the capability query, which IS the no-availability environment),
 * every named refusal, and emission identity (pointer is runtime vocabulary — the generated
 * CSS is byte-identical to seek's, which is what lets both share one rule). The live-driving
 * fixtures need a real pointer and live in tests/browser/motion-pointer.test.js.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, motion, settled, rejections } = await load('directives');
wireDirectives([motion({ inertia: 0 })]);

const doc = dom.window.document;
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => r()));
const progressOf = (el) => Number(el.style.getPropertyValue('--vm-p'));

const mount = async (attr) => {
  const el = doc.createElement('div');
  el.setAttribute('data-vd-motion', attr);
  doc.body.appendChild(el);
  await settled();
  await frame();
  await frame();
  return el;
};

test('FIXTURE 3 — no availability: the variable holds the FIRST entry\'s rest, per source', async () => {
  /** jsdom's matchMedia never matches `(hover: hover) and (pointer: fine)` — this environment
   *  IS the coarse-pointer device the rest table exists for. */
  const distance = await mount("{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'distance' }");
  assert.equal(progressOf(distance), 1, 'distance rests at 1 — leaving scope IS the rest pose');
  const x = await mount("{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'x' }");
  assert.equal(progressOf(x), 0.5, 'x rests at center');
  distance.remove(); x.remove();
  await settled();
});

test('FIXTURE 4 (fallback half) — a chain ending in scroll DRIVES BY SCROLL when pointer is unavailable', async () => {
  const el = await mount("{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'x, scroll' }");
  /** Scroll-driven means the ordinary window math owns the number — at the jsdom page top the
   *  variable is whatever scroll says, NOT x's rest of 0.5. */
  assert.notEqual(progressOf(el), 0.5, 'the fallback engaged: scroll math, not the rest value');
  el.remove();
  await settled();
});

test('FIXTURE 5 — every refusal, by its own name', async () => {
  const shapes = [
    ["{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'x, x' }", 'motion-pointer-duplicate'],
    ["{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'x, rest' }", 'motion-pointer-rest-token'],
    ["{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'scroll, x' }", 'motion-pointer-scroll-first'],
    ["{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'y', scroll: '70%, 30%' }", 'motion-pointer-with-scroll'],
    ["{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'y', stagger: '5%' }", 'motion-pointer-with-stagger'],
    ["{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'x, scroll, y' }", 'motion-pointer-unreachable'],
    ["{ keyframes: { opacity: '0% 0, 100% 1' }, pointer: 'sideways' }", 'motion-setting-pointer'],
  ];
  for (const [attr, code] of shapes) {
    const el = await mount(attr);
    assert.ok(rejections().some((r) => r.code === code), `${code} was reported`);
    el.remove();
  }
  await settled();
});

test('FIXTURE 6 — emission identity: pointer CSS is byte-identical to seek CSS', async () => {
  /** Through the real server emitter, which shares generation with the client. */
  const { renderMotion } = await load('directives/motion');
  const page = (extra) => new JSDOM(
    `<!doctype html><body><div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }${extra} }"></div></body>`
  ).window.document;
  const seekDoc = page('');
  const pointerDoc = page(", pointer: 'x'");
  const seek = renderMotion(seekDoc);
  const pointer = renderMotion(pointerDoc);
  assert.equal(seek.rendered, 1, 'the control rendered');
  assert.equal(pointer.rendered, 1, 'the pointer element rendered — the emitter accepts the vocabulary');
  const cssOf = (d) => d.head.querySelector('style[data-vm-sheet="motion"]')?.textContent ?? '';
  /** The measure-something rule: a silent probe proves nothing. */
  assert.match(cssOf(seekDoc), /@keyframes vm-/, 'the control emitted real keyframes');
  assert.equal(cssOf(pointerDoc), cssOf(seekDoc),
    'byte-identical — the pointer setting never joins the hash; one rule serves both drivers');
  assert.equal(pointerDoc.querySelector('[data-vm-motion]').getAttribute('data-vm-motion'),
    seekDoc.querySelector('[data-vm-motion]').getAttribute('data-vm-motion'),
    'and the marker hashes MATCH — same identity, different driver');
});

test('FIXTURE 7 — the gauntlet\'s pointer row: a pointer-sourced play emits SEEK, not transition', async () => {
  const { renderMotion } = await load('directives/motion');
  const page = (attr) => new JSDOM(`<!doctype html><body><div data-vd-motion="${attr}"></div></body>`).window.document;
  const KEYS = "{ keyframes: { opacity: '0% 0.2, 100% 1' }";
  const plainPlay = page(`${KEYS}, play: 0.3 }`);
  const pointerPlay = page(`${KEYS}, pointer: 'x', play: 0.3 }`);
  renderMotion(plainPlay);
  renderMotion(pointerPlay);
  const cssOf = (d) => d.head.querySelector('style[data-vm-sheet=\"motion\"]')?.textContent ?? '';
  assert.match(cssOf(plainPlay), /transition-property/, 'the control: a plain play is transition mode');
  assert.doesNotMatch(cssOf(pointerPlay), /transition-property/, 'the pointer row refused transition mode');
  assert.match(cssOf(pointerPlay), /@keyframes vm-/, 'and it fell through to seek — the ramp\'s home');
});
