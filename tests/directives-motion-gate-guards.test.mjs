/**
 * The gate guards — both halves of the oscillation defense.
 *
 * BEHAVIORAL: a `when` gate that flips more than four times inside the rolling window is a
 * feedback loop (the wiggle found live: an in-view line inside the element's own translate
 * span); the breaker holds the last answer, reports `motion-gate-oscillating` ONCE, and
 * releases after a quiet window. STATIC: an element sensing its own position while a `when`
 * gates a transform on it is diagnosed at activation, before anything wiggles.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true, url: 'https://x.test/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet',
  'location', 'history', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, motion, settled, rejections } = await load('directives');
wireDirectives([motion({ inertia: 0 })]);
const isProduction = process.env.VERA_DIST === 'production';

const mount = async (markup) => {
  const host = dom.window.document.createElement('div');
  host.innerHTML = markup;
  for (const el of host.querySelectorAll('[data-vd-motion]')) {
    Object.defineProperty(el, 'offsetTop', { value: 300, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 100, configurable: true });
  }
  dom.window.document.body.appendChild(host);
  await settled();
  await new Promise((r) => setTimeout(r, 40));
  return host;
};

test('the oscillation breaker: five flips in the window holds the gate and reports once', async () => {
  const host = await mount(`
    <div id="osc" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, when: '.on', play: 0.2, scroll: '100%, 0%' }">x</div>`);
  const el = host.querySelector('#osc');

  /** The CONTROL first: two calm flips are ordinary gating, no report. */
  for (const state of [true, false]) {
    el.classList.toggle('on', state);
    await new Promise((r) => setTimeout(r, 120));
  }
  assert.equal(rejections(el).filter((r) => r.code === 'motion-gate-oscillating').length, 0,
    'the CONTROL: calm gating never trips the breaker');

  /** The loop: rapid flips inside the rolling window. Frames drive the evaluation. */
  for (let i = 0; i < 10; i++) {
    el.classList.toggle('on');
    await new Promise((r) => setTimeout(r, 45));
  }
  await new Promise((r) => setTimeout(r, 80));
  const tripped = rejections(el).filter((r) => r.code === 'motion-gate-oscillating');
  assert.equal(tripped.length, 1, 'held and reported exactly once');

  host.remove();
  await settled();
});

test('the static diagnosis: sensing your own position under a transform-moving when is named', async () => {
  if (isProduction) return;
  const host = await mount(`
    <div id="feed" data-vd-in-view="seen"
         data-vd-motion="{ keyframes: { translate-y: '0% 40, 100% 0' }, when: '.seen', play: 0.3 }">x</div>`);
  const codes = rejections(host.querySelector('#feed')).map((r) => r.code);
  assert.ok(codes.includes('motion-sensor-self-feed'), `named at activation, got: ${codes}`);

  /** And the clean shape stays clean: the sensor on a WRAPPER draws no warning. */
  const clean = await mount(`
    <div data-vd-in-view="seen2">
      <div id="ok" data-vd-motion="{ keyframes: { translate-y: '0% 40, 100% 0' }, when: '.seen2', play: 0.3 }">x</div>
    </div>`);
  assert.equal(rejections(clean.querySelector('#ok')).filter((r) => r.code === 'motion-sensor-self-feed').length, 0,
    'the guard pattern itself is never flagged');

  host.remove();
  clean.remove();
  await settled();
});
