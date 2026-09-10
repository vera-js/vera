/**
 * TRANSITION-MODE PLAY — compile-time dispatch, no authoring surface.
 *
 * A play whose value CSS transitions can express emits base declarations + an active state and
 * the driver's whole job is ONE attribute flip (`data-vm-on`); the compositor owns the clock
 * (the jank harness's numbers are the decision record). Everything transitions cannot carry
 * keeps the seek-mode ramp: progress/tick riders, pulse shapes, bands, mixed-shape composites.
 *
 * jsdom asserts DISPATCH and the TOGGLE — which mode a value compiles to, what the sheet holds,
 * when the marker flips. Value-level truth (the transition actually animating, native reversal,
 * linear() overshoot) is browser business.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><head></head><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent',
  'MutationObserver', 'CSSStyleSheet', 'getComputedStyle', 'IntersectionObserver', 'ResizeObserver']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, motion, wireTicks, settled, rejections } = await load('directives');
wireDirectives([motion({ inertia: 0 })]);
wireTicks({ noop: () => {} });

const doc = dom.window.document;
const sheetText = () =>
  [...doc.querySelectorAll('style[data-vm-sheet="motion"]')].map((n) => n.textContent).join('\n');

const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => r()));
const mount = async (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  for (const el of host.querySelectorAll('[data-vd-motion]')) {
    Object.defineProperty(el, 'offsetTop', { value: 300, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 200, configurable: true });
  }
  doc.body.appendChild(host);
  await settled();
  await frame();
  await frame();
  return host;
};

test('a from→to play compiles to TRANSITION mode: three rules, longhands, no variable', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0.2, 100% 1', translate-y: '0% 40px, 100% 0px' }, when: '.go', play: 0.6, ease: 'ease-out' }">x</div>`);
  const el = host.querySelector('div');
  const hash = el.getAttribute('data-vm-motion');
  assert.match(hash ?? '', /^[0-9a-f]{8}$/, 'marked');
  assert.equal(el.style.getPropertyValue('--vm-p'), '', 'no seek variable exists in this mode');

  const css = sheetText();
  /** Target order follows authored order — opacity first here, so filter leads. */
  assert.match(css, new RegExp(`\\[data-vm-motion="${hash}"\\]\\[data-vm-motion\\] \\{ filter: `), 'base rule');
  assert.match(css, /transition-property: filter, transform;/, 'longhands, never the shorthand');
  assert.match(css, /transition-duration: 0\.6s, 0\.6s;/, 'the authored seconds per target');
  assert.match(css, /transition-timing-function: ease-out, ease-out;/, 'author ease times plain targets');
  assert.match(css, new RegExp(`\\[data-vm-motion="${hash}"\\]\\[data-vm-on\\]`), 'the active rule');
  assert.match(css, /@media \(scripting: none\)[^}]*transition: none/, 'no-JS gets the END state statically');
  assert.ok(css.indexOf('[data-vm-on]') > css.indexOf('transition-property'),
    'active AFTER base — order is the flip mechanism');

  /** The toggle: gate opens → marker on; closes → off (native reversal carries the values). */
  assert.equal(el.hasAttribute('data-vm-on'), false, 'resting below the gate');
  el.classList.add('go');
  await settled();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(el.hasAttribute('data-vm-on'), true, 'entered: one attribute flip IS the driver');
  el.classList.remove('go');
  await settled();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(el.hasAttribute('data-vm-on'), false, 'left: the platform reverses from current');

  host.remove();
  await settled();
  assert.equal(el.hasAttribute('data-vm-on'), false, 'teardown strips the marker');
});

test('a shaped single member synthesizes linear() — overshoot points and all', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { translate-y: '0% 24px, 70% -5px, 100% 0px' }, when: '.go', play: 0.55 }">x</div>`);
  const el = host.querySelector('div');
  assert.match(el.getAttribute('data-vm-motion') ?? '', /^[0-9a-f]{8}$/);
  const css = sheetText();
  /** Normalised (v−v0)/(vN−v0): 24→0 over the run, so the −5 dip lands PAST 1 — overshoot. */
  assert.match(css, /transition-timing-function: linear\(0 0%, 1\.20[0-9]* 70%, 1 100%\)/,
    'the value trajectory IS the timing function, overshoot legal');
  host.remove();
  await settled();
});

test('run-once latches the marker through the gate closing', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, when: '.go', play: 0.3, run-once: true }">x</div>`);
  const el = host.querySelector('div');
  el.classList.add('go');
  await settled();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(el.hasAttribute('data-vm-on'), true);
  el.classList.remove('go');
  await settled();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(el.hasAttribute('data-vm-on'), true, 'latched: run-once never lets go');
  host.remove();
  await settled();
});

test('the ramp fallback holds exactly the agreed matrix', async () => {
  /** Each of these plays, but through the SEEK mode — the variable exists, no active rule does. */
  for (const [raw, why] of [
    [`{ keyframes: { opacity: '0% 0, 100% 1' }, play: 0.3, progress: '--x' }`, 'a progress rider needs the live number'],
    [`{ keyframes: { opacity: '0% 0, 100% 1' }, tick: 'noop', play: 0.3 }`, 'a tick rider needs the live number'],
    [`{ keyframes: { opacity: '0% 0, 50% 1, 100% 0' }, play: 0.3 }`, 'a pulse has no net change to transition'],
    [`{ keyframes: { opacity: '0% 0, 100% 1; [0-560]: 0% 0.5, 100% 1' }, play: 0.3 }`, 'bands stay seek-mode in v1'],
    [`{ keyframes: { translate-y: '0% 40px, 50% 10px, 100% 0px', rotate: '0% 0deg, 100% 90deg' }, play: 0.3 }`,
      'a shaped member beside a co-member would smear its curve — refuse-don’t-distort'],
  ]) {
    const host = await mount(`<div data-vd-motion="${raw.replaceAll('"', '&quot;')}">x</div>`);
    const el = host.querySelector('div');
    assert.match(el.getAttribute('data-vm-motion') ?? '', /^[0-9a-f]{8}$/, `${why}: still animates`);
    const css = sheetText();
    assert.ok(!new RegExp(`\\[data-vm-motion="${el.getAttribute('data-vm-motion')}"\\]\\[data-vm-on\\]`).test(css),
      `${why}: seek mode, no active rule`);
    host.remove();
    await settled();
  }
});

test('pulse shapes still PLAY on the ramp — the fallback is behaviour, not a refusal', async () => {
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 50% 1, 100% 0' }, when: '.go', play: 0.3 }">x</div>`);
  const el = host.querySelector('div');
  assert.equal(rejections(el).length, 0, 'nothing refused');
  el.classList.add('go');
  await settled();
  /** Bounded poll, not a chosen instant — a loaded machine stretches a 0.3s ramp past any
   *  fixed sleep (recorded flake: 1 in 4 under parallel suite load). */
  let done = false;
  for (let i = 0; i < 300 && !done; i++) {
    await frame();
    done = Number(el.style.getPropertyValue('--vm-p')) > 0.9;
  }
  assert.ok(done, 'the ramp drove the pulse to the timeline end');
  host.remove();
  await settled();
});

test('TIER C: a plain scrub is cascade-driven — constants written once, the variable never inline', async () => {
  /** The dispatch's positive control (a tier that never engages looks identical to one that
   *  works): marker present, range constants inline, the shared rule carrying the clamp/divide,
   *  and NO per-frame --vm-p write — CSS derives it from the scroller's one variable. This
   *  suite wires inertia 0, which is tier C's condition; the scroll suite's default inertia is
   *  the tier-J layering case. Value truth: the browser parity suite's twin A rides this tier. */
  const host = await mount(`<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }">x</div>`);
  const el = host.querySelector('div');
  assert.match(el.getAttribute('data-vm-motion') ?? '', /^[0-9a-f]{8}$/, 'generated');
  assert.equal(el.style.getPropertyValue('--vm-p'), '', 'no inline seek write');
  assert.notEqual(el.style.getPropertyValue('--vm-r0'), '', 'range start constant');
  assert.notEqual(el.style.getPropertyValue('--vm-r1'), '', 'range size constant');
  assert.ok(sheetText().includes('clamp(0, calc((var(--vm-s, 0)'), 'the shared rule derives the number');
  host.remove();
  await settled();

  /** The LAYERING control: per-element inertia forces tier J — the inline write returns. */
  const chased = await mount(`<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, inertia: 0.2 }">x</div>`);
  const el2 = chased.querySelector('div');
  await new Promise((r) => setTimeout(r, 60));
  assert.notEqual(el2.style.getPropertyValue('--vm-p'), '', 'a chase writes inline over the rule');
  chased.remove();
  await settled();
});
