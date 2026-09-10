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
/**
 * THE FLIP'S INSTRUMENT (write-path stage 4). jsdom evaluates no CSS animation, so value-level
 * claims — composed transforms, clamped opacities — moved to the browser suites, which read
 * computed style. What jsdom CAN answer honestly is the generated SURFACE: the progress variable
 * the driver writes (inline, readable) and the animation mark. Progress maps 1:1 onto the old
 * 0→1 opacity fixtures, so the numeric expectations carry over unchanged.
 */
const progressOf = (el) => Number(el.style.getPropertyValue('--vd-p'));
const animating = (el) => /^[0-9a-f]{8}$/.test(el.getAttribute('data-vd-a') ?? '');
/**
 * Bounded poll — for elements whose preset carries `play` (the shipped ten ramp over 0.6s now),
 * "reached the end" is a claim about the RAMP COMPLETING, and sampling one frame after settle
 * reads mid-flight. Real jsdom timers drive the driver's rAF loop, so waiting is honest and
 * deterministic under a generous bound; timing SHAPE stays the browser sweep test's business.
 */
const until = async (fn, what) => {
  /** 300 frames ≈ 5s of real timers: a 0.6s ramp with headroom for a loaded machine — the
   *  120-frame bound flaked under parallel load, which is a recording of the machine's speed. */
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await frame();
  }
  assert.fail(`timed out: ${what}`);
};

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
  assert.ok(animating(el), 'the generated animation is marked on the element');
  await until(() => progressOf(el) === 1, 'the preset ramp (play: 0.6) completed at the clamped end');
  host.remove();
  await settled();
  assert.ok(!animating(el), 'teardown cleared what it wrote');
  assert.equal(el.style.getPropertyValue('--vd-p'), '', 'the variable too');
});

test('an object value with per-property keyframes writes both categories', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1', translate-y: '0% 40px, 100% 0px', rotate: '0% 0deg, 100% 90deg' } }">x</div>`);
  const el = host.querySelector('div');
  /** Composition order is value-level truth — pinned by the browser parity suite now. Here:
   *  one generated animation carries all three properties, and the driver reached the end. */
  assert.ok(animating(el), 'one generated animation for all three properties');
  assert.equal(progressOf(el), 1);
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

test('geometry-position keyframes GENERATE since 8d — per-geometry-bucket rules', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0px 0, 400px 1' } }">x</div>`);
  const el = host.querySelector('div');
  /** Length positions normalise against the measured scroll window at generation, so the value
   *  rides the generated path — the last shapes still inline are misaligned-stops-under-eased
   *  and third-party discrete holds. */
  assert.ok(animating(el), 'px stops are a generated animation now');
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
  assert.ok(!animating(el), 'nothing half-applied: the element rests natural');
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
  assert.equal(progressOf(el), 0, 'not matching: rests at the authored start');
  el.classList.add('open');
  /** The shared lazy observer fires on the attribute change, a microtask later. */
  await settled();
  await frame();
  assert.equal(progressOf(el), 1, 'matching: the gate opened and jsdom geometry clamps at the end');
  el.classList.remove('open');
  await settled();
  await frame();
  assert.equal(progressOf(el), 0, 'and back');
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

test('ease needs no module anywhere, and an inexpressible value refuses BY NAME', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: { frames: '0% 0, 100% 1', ease: 'ease-in' } } }">x</div>`);
  const el = host.querySelector('div');
  /** The easings pack is RETIRED with the inline path: the browser evaluates every curve, so
   *  there is no module to demand and no wiring step to forget. */
  assert.equal(rejections(el).length, 0, 'no module demanded for a curve the browser solves');
  assert.match(el.getAttribute('data-vd-a') ?? '', /^[0-9a-f]{8}$/, 'rides the generated path');
  host.remove();
  await settled();

  /** The LAST inexpressible shape: a composite target (transform) whose members misalign under
   *  ONE non-linear ease — no CSS spelling exists, so the element drops with the reason. */
  const gone = await mount(
    `<div data-vd-motion="{ keyframes: { translate-y: '0% 10px, 50% 5px, 100% 0px', rotate: '0% 0deg, 100% 90deg' }, ease: 'ease-in' }">x</div>`);
  const dropped = gone.querySelector('div');
  assert.equal(dropped.hasAttribute('data-vd-a'), false, 'nothing generated');
  assert.ok(rejections(dropped).some((r) => r.code === 'motion-inexpressible'),
    'refused by name, never silently still');
  gone.remove();
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
  await until(() => animating(el) && progressOf(el) === 1, 'the member still animates on defaults');
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

/**
 * `play` rather than `inertia` since the scroll/play pass: `when` GATES now, so `when` alone would
 * let this element scrub with the page rather than run end-to-end, and the latch under test is a
 * property of a playthrough. `play: 0` is the instant version of what `inertia: 0` used to express
 * here — the two name the same transition, which is why writing both is refused.
 */
test('attribute edits rebuild through the engine, and the run-once latch survives them', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, run-once: true, when: '.go', play: 0 }">x</div>`);
  const el = host.querySelector('div');
  el.classList.add('go');
  await settled();
  await frame();
  await until(() => progressOf(el) === 1, 'played through and latched');
  /** Edit the value: the engine tears down and reactivates this directive. */
  /** play: 0 here too — the claim under test is the LATCH surviving the rebuild, and a 0.2s ramp
   *  would still be mid-flight when jsdom's next frame samples it. Duration is the ramp's own
   *  tested concern (the browser sweep test), not this one's. */
  el.setAttribute('data-vd-motion', `{ keyframes: { opacity: '0% 0, 100% 1' }, run-once: true, when: '.go', play: 0 }`);
  await settled();
  await frame();
  await frame();
  el.classList.remove('go');
  await settled();
  await frame();
  await until(() => progressOf(el) === 1, 'latched means latched: the rebuild carried it');
  host.remove();
  await settled();
});

test('an unwired pack key names the PACK, and the literal map cannot drift from the vocabulary', async () => {
  /** This suite wires motion + presets and no packs — the fixture is the wiring's absence. */
  const host = await mount(`<div data-vd-motion="{ keyframes: { background: '0% red, 100% blue' } }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-pack-unwired'),
    'the unwired-module rule, one level down from preset names');
  assert.ok(!reasons.some((r) => r.code === 'motion-no-such-key'),
    'and NOT no-such-key: background is real and correctly spelled');

  /**
   * SETTINGS refuse identically — omni's symmetry question, answered by construction here: with
   * the pack unwired neither its properties nor its settings are registered, so both fall to the
   * same map. The alternative — validate-and-store a config string nothing will ever read — is
   * the accepted-and-ignored failure this codebase refuses everywhere else: a loud key beside
   * dead configuration is HALF a refusal story.
   */
  const half = await mount(`<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, frame-url: 'seq/' }">x</div>`);
  const halfReasons = rejections(half.querySelector('div'));
  assert.ok(halfReasons.some((r) => r.code === 'motion-pack-unwired'),
    'an unwired pack SETTING refuses like its property');
  if (!isProduction) {
    /** Prod folds prose to the empty string — a ?? fallback never fires on ''. Guard, not coalesce. */
    assert.ok(halfReasons.some((r) => /sequence/.test(r.message)), 'naming the pack');
  }
  half.remove();
  await settled();
  if (!isProduction) {
    assert.ok(reasons.some((r) => /paint/.test(r.message)), 'the pack is named');
    assert.ok(reasons.some((r) => /wireDirectives\(\[motion, paint\]\)/.test(r.fix ?? '')), 'with the line to write');
  }
  host.remove();
  await settled();

  /** The drift pin: the literal map in parse.ts must equal the generated vocabulary's pack rows. */
  const { readFileSync } = await import('node:fs');
  const vocabulary = JSON.parse(readFileSync(new URL('../packages/directives/motion-vocabulary.json', import.meta.url), 'utf8'));
  const fromArtifact = Object.fromEntries(
    [...vocabulary.properties, ...vocabulary.settings].filter((row) => row.pack).map((row) => [row.key, row.pack]));
  const source = readFileSync(new URL('../packages/directives/src/motion/parse.ts', import.meta.url), 'utf8');
  for (const [key, pack] of Object.entries(fromArtifact)) {
    assert.ok(new RegExp(`['\\\`"]?${key}['\\\`"]?: '${pack}'`).test(source),
      `SHIPPED_PACK_KEYS is missing ${key} → ${pack}; the literal drifted from motion-vocabulary.json`);
  }
});
