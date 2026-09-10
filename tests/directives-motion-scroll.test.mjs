/**
 * **`scroll` names where the animation begins and ends. Scrubbing spreads it across that span;
 * playing runs it at each end.**
 *
 * The pass that replaced `start`/`end` with one key, made `play` the driver switch, and turned
 * `when` from a driver into a gate. Each of those is a behaviour claim rather than a rename, and
 * this file is where they are held.
 *
 * jsdom has no scrolling, so position is expressed by placing elements at different `offsetTop`s
 * against a fixed 768px viewport — an element near the top has had its threshold crossed, one far
 * down the document has not. That is enough for every claim here except reversal on scroll-back,
 * which needs real scrolling and belongs to the browser suite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver',
  'CSSStyleSheet', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, motion, presets, settled, rejections } = await load('directives');
wireDirectives([motion, presets]);

const doc = dom.window.document;
const K = "keyframes: { opacity: '0% 0, 100% 1' }";

/** `top` is the element's document position; the viewport is 768 tall and never scrolls. */
const at = async (attr, top = 100) => {
  const el = doc.createElement('div');
  el.setAttribute('data-vd-motion', attr);
  Object.defineProperty(el, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: 200, configurable: true });
  doc.body.appendChild(el);
  await settled();
  await new Promise((r) => setTimeout(r, 25));
  return el;
};

/** THE FLIP'S INSTRUMENT — see directives-motion.test.mjs: jsdom evaluates no CSS animation, so
 *  value-level claims live in the browser suites; jsdom reads the generated SURFACE. Progress maps
 *  1:1 onto the old 0→1 opacity fixtures, so numeric expectations carry over unchanged. */
const progressOf = (el) => Number(el.style.getPropertyValue('--vd-p'));
const animating = (el) => /^[0-9a-f]{8}$/.test(el.getAttribute('data-vd-a') ?? '');
const opacity = (el) => { const v = progressOf(el); return Number.isFinite(v) ? String(Math.min(1, Math.max(0, v))) : undefined; };

test('the long form of scroll reproduces the defaults exactly', async () => {
  const written = await at(`{ ${K}, scroll: 'top bottom, bottom top' }`);
  const omitted = await at(`{ ${K} }`);

  assert.ok(opacity(omitted) !== undefined, 'the control: the default range animated at all');
  assert.equal(opacity(written), opacity(omitted),
    "'start bottom' → 'end start' IS the default — spelling it out must change nothing");
});

test('one half sets the first end and leaves the second at its default', async () => {
  const one = await at(`{ ${K}, scroll: '70%' }`);
  const none = await at(`{ ${K} }`);

  assert.ok(opacity(one) !== undefined && opacity(none) !== undefined, 'control: both animated');
  assert.notEqual(opacity(one), opacity(none), 'the given half moved the range');
});

test('play runs at a threshold instead of scrubbing across a span', async () => {
  /** Near the top: the 70% line is behind us, so the play has run. */
  const entered = await at(`{ ${K}, scroll: '70%', play: 0 }`, 100);
  /** Far down the document: the line has not been reached. */
  const waiting = await at(`{ ${K}, scroll: '70%', play: 0 }`, 3000);

  assert.equal(opacity(entered), '1', 'past the threshold: at the authored end');
  assert.equal(opacity(waiting), '0', 'before it: at the authored start');
});

test('a play sits at ONE end or the other — it never scrubs between them', async () => {
  /**
   * The claim that separates the two modes. A scrub at this position lands mid-range; a play at the
   * same position must be pinned to an end, because progress is not a function of scroll for it.
   */
  const scrubbed = await at(`{ ${K}, scroll: '70%' }`, 400);
  const played = await at(`{ ${K}, scroll: '70%', play: 0 }`, 400);

  const between = Number(opacity(scrubbed));
  assert.ok(between > 0 && between < 1, `control: the scrub is mid-range (${between})`);
  assert.ok(['0', '1'].includes(opacity(played)), `the play is at an end (${opacity(played)})`);
});

test('when GATES a scrub rather than replacing the driver', async () => {
  const closed = await at(`{ ${K}, when: '.on' }`, 400);
  const open = doc.createElement('div');
  open.className = 'on';
  open.setAttribute('data-vd-motion', `{ ${K}, when: '.on' }`);
  Object.defineProperty(open, 'offsetTop', { value: 400, configurable: true });
  Object.defineProperty(open, 'offsetHeight', { value: 200, configurable: true });
  doc.body.appendChild(open);
  await settled();
  await new Promise((r) => setTimeout(r, 25));

  assert.equal(opacity(closed), '0', 'not matching: resting at the authored start');

  /**
   * **The whole point of the change.** Under the old behaviour a match jumped the element to its
   * END; now it resumes the ordinary scrub, so a matching element at this position sits BETWEEN the
   * ends. An assertion of "not 0" would have passed under both.
   */
  const live = Number(opacity(open));
  assert.ok(live > 0 && live < 1, `matching: scrubbing with the page (${live}), not jumped to the end`);
});

test('the old behaviour is still expressible, and now says so out loud', async () => {
  /** `when` + `play` is what `when` alone used to mean: gate, then run end-to-end. */
  const el = await at(`{ ${K}, when: '.go', play: 0 }`, 400);
  assert.equal(opacity(el), '0', 'gate closed');

  el.classList.add('go');
  await settled();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(opacity(el), '1', 'gate open: the whole animation, not a scrub position');
});

test('play and inertia name the same transition, so both is refused', async () => {
  const el = await at(`{ ${K}, play: 0.5, inertia: 0.2 }`);
  const reasons = rejections(el);
  assert.ok(reasons.some((r) => r.code === 'motion-play-with-inertia'),
    'refused rather than silently ranked — the loser would be a value nothing reads');
  if (!isProduction) {
    assert.ok(reasons.some((r) => /only one/.test(r.message)), 'and says why');
  }
});

test('ease is refused for a play, and no longer refused for a gate', async () => {
  const played = rejections(await at(`{ ${K}, play: 0.5, ease: 'ease-in' }`));
  const gated = rejections(await at(`{ ${K}, when: '.x', ease: 'ease-in' }`));

  assert.ok(played.some((r) => r.code === 'motion-ease-with-play'),
    'a play steps end-to-end and never visits the keyframes between');
  assert.ok(!gated.some((r) => r.code === 'motion-ease-with-play'),
    'a GATED element still scrubs, so its curve is traversed and ease means something again');
});

test('keyframe positions are 0-100, like CSS keyframes', async () => {
  const over = rejections(await at(`{ keyframes: { opacity: '0% 0, 120% 1' } }`));
  assert.ok(over.some((r) => r.code === 'motion-bad-position'),
    'the ±300 extrapolation range moved to scroll, where it is a real capability');

  /** And the control: the in-range spelling of the same intent is accepted. */
  const fine = await at(`{ keyframes: { opacity: '0% 0, 100% 0.8' } }`);
  assert.ok(animating(fine), 'an in-range value still animates');
});

test('scroll refuses a space where a comma belongs — because the space already means something', async () => {
  /**
   * `'70% 50%'` is a legal SINGLE alignment: both halves of an alignment take a percentage, so it
   * reads as "the point 70% down the element, at 50% of the viewport". Nothing is ambiguous — two
   * valid things are being distinguished, and the comma picks the pair. Which is why accepting a
   * space later would take a working spelling away.
   */
  const single = await at(`{ ${K}, scroll: '70% 50%' }`);
  assert.ok(!rejections(single).some((r) => r.code === 'motion-setting-range'),
    'accepted as one alignment with a fractional edge');

  const tooMany = rejections(await at(`{ ${K}, scroll: '10%, 20%, 30%' }`));
  assert.ok(tooMany.some((r) => r.code === 'motion-setting-range'), 'three halves is not a range');
});

/**
 * **`progress` writes the timeline position to a custom property, so CSS can read it.**
 *
 * The reach argument rather than a convenience: the animatable-property table is a closed list and a
 * number in CSS is not, so gradients, `box-shadow`, `clip-path` and anything `calc()` touches become
 * reachable without this package growing an entry for each. It is also the seam pointing toward the
 * platform — a page can move its visual layer into CSS and keep the range naming, gating and regions
 * from here.
 *
 * Opt-in by NAMING the property, which is what makes it usable: the author picks a name their own
 * stylesheet already talks about, and a page that does not read it pays no per-frame write.
 */
test('progress renames the variable — one write serves the animation AND the author', async () => {
  /**
   * FLIP SEMANTICS: the variable is the ENGINE now, so every generated element carries one —
   * `--vd-p` by default — and `progress: '--p'` RENAMES it rather than adding a second write.
   * The old "nothing without the setting" claim inverted into "the default name, without it".
   */
  const named = await at(`{ ${K}, progress: '--p' }`);
  const unnamed = await at(`{ ${K} }`);

  const value = Number(named.style.getPropertyValue('--p'));
  assert.ok(Number.isFinite(value) && value > 0 && value < 1,
    `the author's name carries the number (${value})`);
  assert.equal(named.style.getPropertyValue('--vd-p'), '',
    'ONE write: the default name is not also written');
  assert.ok(Number.isFinite(progressOf(unnamed)), 'unnamed elements ride the default name');
});

test('progress refuses a name that is not a custom property', async () => {
  const el = await at(`{ ${K}, progress: 'p' }`);
  assert.ok(rejections(el).length > 0,
    'a bare word would reach setProperty and be silently dropped by the CSSOM');
  /** The refusal drops the SETTING, never the animation: the element proceeds on the default
   *  variable — refuse-and-continue, this package's shape, observed rather than assumed. */
  assert.ok(animating(el), 'the animation itself proceeds');
  assert.ok(Number.isFinite(progressOf(el)), 'on the default variable');
});

test('teardown removes the progress property', async () => {
  const el = await at(`{ ${K}, progress: '--p' }`);
  assert.notEqual(el.style.getPropertyValue('--p'), '', 'control: it was written');
  const renamed = el.style.getPropertyValue('--p');
  assert.ok(renamed !== '', `renamed variable carries the number (${renamed})`);

  el.remove();
  await settled();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(el.style.getPropertyValue('--p'), '',
    'a stale number reads as a bar frozen part-way rather than as nothing');
});
