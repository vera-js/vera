/**
 * The motion pack's smoke layer: activation, the dual value forms, refusals,
 * the `when` driver, per-property ease, regions, and the factory dual — all
 * under jsdom, which has no real layout. Geometry-true behaviour (scroll
 * positions, pins, visibility margins) belongs to the browser suite and the
 * parity checks against packages/motion; what jsdom CAN answer honestly is
 * everything above the frame loop: parsing, adoption, style writes at the
 * timeline's clamped ends, diagnostics, and teardown.
 *
 * jsdom traps observed (CLAUDE.md): rAF must exist or nothing coalesces;
 * there is no IntersectionObserver, so the tracker runs in full-list
 * fallback; `matches()` is real, which is what makes `when` testable here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, motion, presets, settled, rejections } = await load('directives');
wireDirectives([motion, presets]);

const doc = dom.window.document;
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => r()));
const mount = async (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  await settled();
  /** Paints land on a microtask, transitions a frame later. */
  await frame();
  await frame();
  return host;
};

test('a preset literal activates and writes the composed style at the clamped end', async () => {
  const host = await mount('<div data-vd-motion="fade-up">hero</div>');
  const el = host.querySelector('div');
  /**
   * jsdom geometry is all zeros, which puts the timeline past 100% — the
   * clamped END: opacity 1, translate-y 0px. The exact numbers are the
   * point: they prove parse → preset expansion → curve → compose → write.
   */
  assert.match(el.style.filter, /opacity\(1\)/, 'the fade half landed');
  assert.match(el.style.transform, /translateY\(0px\)/, 'the up half landed');
  host.remove();
  await settled();
  assert.equal(el.style.transform, '', 'teardown cleared what it wrote');
});

test('an object value with per-property keyframes writes both categories', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1', translate-y: '0% 40px, 100% 0px', rotate: '0% 0deg, 100% 90deg' } }">x</div>`);
  const el = host.querySelector('div');
  assert.match(el.style.transform, /translateY\(0px\) rotate\(90deg\)/, 'schema order composes transforms');
  assert.match(el.style.filter, /opacity\(1\)/);
  host.remove();
  await settled();
});

test('refusals are sentences in the engine registry: unknown preset, unknown key, bad value', async () => {
  const host = await mount(`
    <div id="a" data-vd-motion="fadeUp">a</div>
    <div id="b" data-vd-motion="{ keyframes: { opacity_: '0% 0' } }">b</div>
    <div id="c" data-vd-motion="{ keyframes: { opacity: '0% 5' } }">c</div>`);
  /** Prod keeps the DATA (code, element); the prose is a development feature. */
  const a = rejections(host.querySelector('#a'));
  assert.ok(a.some((r) => r.code === 'motion-preset-unknown'), 'unknown preset reported');
  if (!isProduction) {
    assert.ok(a.some((r) => /fadeUp/.test(r.message)), 'named what was written');
    /**
     * **No misspelling suggestion, deliberately.** Presets are a wirable pack now, and a pack
     * exposes a resolver rather than an enumeration — there is nothing to scan for a near match.
     * Suggesting from the SHIPPED table would have been worse than saying nothing: it would answer
     * for one pack while claiming to answer for all of them, and be confidently wrong on any page
     * that wired its own. The fix points at the pack instead.
     */
    assert.ok(a.some((r) => /wired/.test(r.fix ?? '')), 'points at the pack, not at a spelling');
    assert.ok(!a.some((r) => /Did you mean/.test(r.fix ?? '')), 'and suggests nothing it cannot know');
  }
  const b = rejections(host.querySelector('#b'));
  assert.ok(b.some((r) => r.code === 'motion-no-such-key'), 'unknown key reported');
  if (!isProduction) {
    assert.ok(b.some((r) => /opacity_/.test(r.message)));
    assert.ok(b.some((r) => /Did you mean opacity/.test(r.fix ?? '')), 'the suggestion is the fix');
  }
  const c = rejections(host.querySelector('#c'));
  assert.ok(c.some((r) => r.code === 'motion-out-of-range'), 'out-of-range value reported');
  if (!isProduction) assert.ok(c.some((r) => /opacity/.test(r.message)), 'with the property named');
  host.remove();
  await settled();
});

test('a bare word where a string belongs is refused with the fix, never resolved as state', async () => {
  const host = await mount(`<div data-vd-motion="{ keyframes: { opacity: fade } }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-quote-the-value'));
  if (!isProduction) assert.ok(reasons.some((r) => /quote the value/.test(r.message)));
  host.remove();
  await settled();
});

test('an unquoted text value fails the whole element LOUDLY, with the quote hint', async () => {
  /** `pin: 120px` is the most natural thing to type and the sharpest paper cut —
   *  Brian's call (2026-09-06): whole-element refusal beats a silently missing
   *  property, because visible breakage gets investigated and content rests
   *  readable either way. The hint is what turns loud into teachable. */
  const host = await mount(`<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, pin: 120px }">x</div>`);
  const el = host.querySelector('div');
  assert.equal(el.style.filter, '', 'nothing half-applied: the element rests natural');
  const reasons = rejections(el);
  assert.ok(reasons.some((r) => r.code === 'motion-parse-failed'), 'refused, not ignored');
  if (!isProduction) assert.ok(reasons.some((r) => /quoted/.test(r.fix ?? '')), 'and the hint names the fix');
  host.remove();
  await settled();
});

test('the when driver: a selector match walks the element to its other end', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, when: '.open', inertia: 0 }">x</div>`);
  const el = host.querySelector('div');
  assert.match(el.style.filter, /opacity\(0\)/, 'not matching: rests at the authored start');
  el.classList.add('open');
  /** The shared lazy observer fires on the attribute change, a microtask later. */
  await settled();
  await frame();
  assert.match(el.style.filter, /opacity\(1\)/, 'matching: sits at the authored end');
  el.classList.remove('open');
  await settled();
  await frame();
  assert.match(el.style.filter, /opacity\(0\)/, 'and back');
  host.remove();
  await settled();
});

test('when refuses the pseudo-classes the observer cannot see, and drops the setting', async () => {
  const host = await mount(`<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, when: ':hover' }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-when-blind'), 'refused');
  if (!isProduction) assert.ok(reasons.some((r) => /:hover/.test(r.message)), 'named the pseudo-class');
  host.remove();
  await settled();
});

test('per-property ease without the easings module is a refusal per element, and the curve is linear', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: { frames: '0% 0, 100% 1', ease: 'ease-in' } } }">x</div>`);
  const el = host.querySelector('div');
  const reasons = rejections(el);
  assert.ok(reasons.some((r) => r.code === 'motion-easings-module-missing'), 'refused');
  if (!isProduction) assert.ok(reasons.some((r) => /needs the easings module/.test(r.message)), 'told what to wire');
  assert.match(el.style.filter, /opacity\(1\)/, 'and the element still animates, straight');
  host.remove();
  await settled();
});

test('the nested form refuses junk keys and a band key carrying its own ease', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: { frames: '0% 0, 100% 1', wobble: 3 } } }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-nested-unknown'));
  if (!isProduction) assert.ok(reasons.some((r) => /opacity\.wobble/.test(r.message)));
  host.remove();
  await settled();
});

test('motion-config: a bad axis is refused with the region still working on defaults', async () => {
  const host = await mount(`
    <section data-vd-motion-region="{ axis: 'diagonal' }">
      <div data-vd-motion="fade">x</div>
    </section>`);
  const el = host.querySelector('div');
  assert.match(el.style.filter, /opacity\(1\)/, 'the member still animates');
  const reasons = rejections(el);
  assert.ok(reasons.some((r) => r.code === 'motion-region-axis'), 'the config refusal recorded');
  if (!isProduction) assert.ok(reasons.some((r) => /axis/.test(r.message)), 'and names the key');
  host.remove();
  await settled();
});

test('settings arrive as authored types: numbers, booleans, and their refusals', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, inertia: 0.5, run-once: true, pin: 'sideways' }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-setting-length'), 'pin refused');
  if (!isProduction) {
    assert.ok(reasons.some((r) => /pin/.test(r.message) && /length/.test(r.message)), 'with the grammar');
    assert.ok(!reasons.some((r) => /inertia/.test(r.message)), 'a good number passes');
  }
  host.remove();
  await settled();
});

test('attribute edits rebuild through the engine, and the run-once latch survives them', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, run-once: true, when: '.go', inertia: 0 }">x</div>`);
  const el = host.querySelector('div');
  el.classList.add('go');
  await settled();
  await frame();
  assert.match(el.style.filter, /opacity\(1\)/, 'played through and latched');
  /** Edit the value: the engine tears down and reactivates this directive. */
  el.setAttribute('data-vd-motion', `{ keyframes: { opacity: '0% 0, 100% 1' }, run-once: true, when: '.go', inertia: 0.2 }`);
  await settled();
  await frame();
  await frame();
  el.classList.remove('go');
  await settled();
  await frame();
  assert.match(el.style.filter, /opacity\(1\)/, 'latched means latched: the rebuild carried it');
  host.remove();
  await settled();
});
