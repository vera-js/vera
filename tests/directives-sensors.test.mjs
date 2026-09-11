/**
 * The sensors pack — environment → state, the third side of the system's symmetry.
 *
 * jsdom has neither `IntersectionObserver` nor `ResizeObserver` and no layout, which is exactly
 * what makes it the right place to pin the DEGRADATION rules: a sensor that cannot sense must
 * still leave the page readable, and "leaves the content visible" is a claim a real browser can
 * never fail loudly enough to catch. The observers themselves are stubbed here where a behaviour
 * needs driving; geometry-true coverage belongs to the browser suite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

/**
 * A drivable IntersectionObserver, so the in-view path is exercised rather than only its
 * fallback. Deliberately installed AFTER the fallback test would want it absent — see below.
 */
const observers = new Set();
class TestIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    observers.add(this);
  }
  observe(el) { this.targets.add(el); }
  unobserve(el) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); observers.delete(this); }
}
const intersect = (el, isIntersecting) => {
  for (const observer of observers) {
    if (observer.targets.has(el)) observer.callback([{ target: el, isIntersecting }], observer);
  }
};

const { wireDirectives, interactions, expressions, sensors, settled, rejections, stateOf } =
  await load('directives');
wireDirectives([expressions, ...interactions, sensors]);

const doc = dom.window.document;
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => r()));
const mount = async (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  await settled();
  return host;
};

test('DEGRADED, NEVER DEAD: with no IntersectionObserver, in-view reports visible', async () => {
  assert.equal(typeof globalThis.IntersectionObserver, 'undefined', 'the control: jsdom really has none');
  const host = await mount(`
    <div data-vd-state="{ seen: false }">
      <p data-vd-in-view="seen" data-vd-show="seen">content</p>
    </div>`);
  assert.equal(host.querySelector('p').hidden, false,
    'a page cannot hide its content over a capability the engine lacks');
  assert.equal(stateOf(host.querySelector('[data-vd-state]')).seen, true);
  host.remove();
  await settled();
});

test('with an observer, in-view writes the state key on each crossing — and only on change', async () => {
  globalThis.IntersectionObserver = TestIntersectionObserver;
  const host = await mount(`
    <div data-vd-state="{ seen: false, hits: 0 }">
      <p data-vd-in-view="seen" data-vd-class="{ revealed: seen }">content</p>
    </div>`);
  const p = host.querySelector('p');
  assert.equal(p.classList.contains('revealed'), false, 'not reported yet');

  intersect(p, true);
  await settled();
  assert.equal(p.classList.contains('revealed'), true, 'entering wrote true');

  /** A repeat report of the SAME answer must not write again — the fixed-point rule. */
  const before = stateOf(host.querySelector('[data-vd-state]')).seen;
  intersect(p, true);
  await settled();
  assert.equal(stateOf(host.querySelector('[data-vd-state]')).seen, before, 'no write for an unchanged reading');

  intersect(p, false);
  await settled();
  assert.equal(p.classList.contains('revealed'), false, 'leaving wrote false');
  host.remove();
  await settled();
});

test('teardown disconnects the observer — a removed element stops sensing', async () => {
  globalThis.IntersectionObserver = TestIntersectionObserver;
  const host = await mount(`
    <div data-vd-state="{ seen: false }"><p data-vd-in-view="seen">x</p></div>`);
  const live = observers.size;
  assert.ok(live > 0, 'the control: an observer was created');
  host.remove();
  await settled();
  assert.ok(observers.size < live, 'and released with the element');
});

test('pointer normalises 0→1 over the element, and re-centres on leave', async () => {
  const host = await mount(`
    <div data-vd-state="{ p: {} }">
      <div id="card" data-vd-pointer="p"></div>
    </div>`);
  const card = host.querySelector('#card');
  /** jsdom has no layout, so the box is supplied — the maths is what is under test. */
  card.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 100 });
  const carrier = host.querySelector('[data-vd-state]');

  card.dispatchEvent(Object.assign(new dom.window.Event('pointermove', { bubbles: true }),
    { clientX: 200, clientY: 100 }));
  await frame();
  await settled();
  assert.deepEqual(stateOf(carrier).p, { x: 0.5, y: 0.5, inside: true }, 'centre of the box');

  card.dispatchEvent(Object.assign(new dom.window.Event('pointermove', { bubbles: true }),
    { clientX: 300, clientY: 150 }));
  await frame();
  await settled();
  assert.deepEqual(stateOf(carrier).p, { x: 1, y: 1, inside: true }, 'bottom-right corner');

  /** Past the edge CLAMPS rather than reporting beyond the element. */
  card.dispatchEvent(Object.assign(new dom.window.Event('pointermove', { bubbles: true }),
    { clientX: 9999, clientY: 9999 }));
  await frame();
  await settled();
  assert.deepEqual(stateOf(carrier).p, { x: 1, y: 1, inside: true }, 'clamped');

  card.dispatchEvent(new dom.window.Event('pointerleave', { bubbles: true }));
  await frame();
  await settled();
  assert.deepEqual(stateOf(carrier).p, { x: 0.5, y: 0.5, inside: false },
    're-centred on leave, so a tilt card returns to rest instead of freezing at the exit angle');
  host.remove();
  await settled();
});

test('swipe runs the program for the DOMINANT axis, and ignores a tap', async () => {
  const host = await mount(`
    <div data-vd-state="{ page: 1 }">
      <div id="deck" data-vd-swipe="{ left: { page: page + 1 }, right: { page: page - 1 } }"></div>
    </div>`);
  const deck = host.querySelector('#deck');
  const carrier = host.querySelector('[data-vd-state]');
  const drag = async (dx, dy) => {
    deck.dispatchEvent(Object.assign(new dom.window.Event('pointerdown', { bubbles: true }), { clientX: 200, clientY: 200 }));
    deck.dispatchEvent(Object.assign(new dom.window.Event('pointerup', { bubbles: true }), { clientX: 200 + dx, clientY: 200 + dy }));
    await settled();
  };

  await drag(-120, 10);
  assert.equal(stateOf(carrier).page, 2, 'a leftward flick ran the left program');
  await drag(120, -10);
  assert.equal(stateOf(carrier).page, 1, 'and rightward the right one');

  /** A diagonal is ONE gesture: the larger axis decides, so this is a down-swipe with no program. */
  await drag(50, 200);
  assert.equal(stateOf(carrier).page, 1, 'the dominant axis had no program, so nothing ran');

  await drag(10, 5);
  assert.equal(stateOf(carrier).page, 1, 'a tap is under the threshold and is not a swipe');
  host.remove();
  await settled();
});

test('refusals: a sensor with no key, a swipe direction that does not exist', async () => {
  const host = await mount(`
    <div data-vd-state="{ n: 0 }">
      <p id="nokey" data-vd-in-view=""></p>
      <p id="sideways" data-vd-swipe="{ sideways: { n: 1 } }"></p>
    </div>`);
  assert.ok(rejections(host.querySelector('#nokey')).some((r) => r.code === 'sensor-no-key'),
    'a sensor with nowhere to write says so rather than sensing into the void');
  assert.ok(rejections(host.querySelector('#sideways')).some((r) => r.code === 'swipe-bad-direction'));
  if (!isProduction) {
    assert.ok(rejections(host.querySelector('#sideways')).some((r) => /left, right, up or down/.test(r.message)));
  }
  host.remove();
  await settled();
});
