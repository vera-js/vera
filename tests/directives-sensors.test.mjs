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
const intersect = (el, isIntersecting, extra = {}) => {
  for (const observer of observers) {
    if (observer.targets.has(el)) observer.callback([{ target: el, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0, ...extra }], observer);
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

test('the :viewport scope measures the whole viewport; the ambient dual is the same attribute said from JS', async () => {
  /** Half one: the scope suffix. */
  const host = await mount(`
    <div data-vd-state="{ p: {} }">
      <div id="vp" data-vd-pointer="p:viewport" style="width:10px"></div>
      <b data-vd-text="p.x"></b>
    </div>`);
  dom.window.dispatchEvent(new dom.window.Event('pointermove'));
  const carrier = host.firstElementChild;
  /** jsdom events lack clientX; construct with properties via Object.assign on a plain Event. */
  const move = (cx, cy) => {
    const event = new dom.window.Event('pointermove', { bubbles: true });
    Object.assign(event, { clientX: cx, clientY: cy });
    dom.window.dispatchEvent(event);
  };
  move(dom.window.innerWidth / 2, 10);
  await settled();
  await new Promise((r) => setTimeout(r, 30));
  await settled();
  assert.ok(Math.abs(stateOf(carrier).p.x - 0.5) < 0.01,
    'x measured against the VIEWPORT, not the 10px element');
  host.remove();
  await settled();

  /** Half two: the ambient dual DELEGATES — the called form is the body attribute, literally,
   *  which is what makes equivalence structural rather than tested twice. */
  const { sensors: sensorsDual } = await load('directives');
  const connector = sensorsDual({ pointer: 'amb' });
  assert.equal(typeof connector, 'function', 'the called form returns a connector for wireDirectives');
  wireDirectives([connector]);
  await settled();
  assert.equal(doc.body.getAttribute('data-vd-pointer'), 'amb:viewport',
    'the delegation: sensors({ pointer }) IS <body data-vd-pointer=\"key:viewport\"> said from JS');
  doc.body.removeAttribute('data-vd-pointer');
  await settled();
});

test(':once latches and :down is a directional latch — the exit edge is the signal', async () => {
  const host = await mount(`
    <div data-vd-state="{ seen: false, reveal: false }">
      <p id="o" data-vd-in-view="seen:once"></p>
      <p id="d" data-vd-in-view="reveal:down"></p>
    </div>`);
  const carrier = host.firstElementChild;
  const once = host.querySelector('#o');
  const dn = host.querySelector('#d');

  intersect(once, true); await settled();
  assert.equal(stateOf(carrier).seen, true, ':once fired');
  intersect(once, false); await settled();
  assert.equal(stateOf(carrier).seen, true, 'and LATCHED — scrolling away does not unreveal');

  intersect(dn, true); await settled();
  assert.equal(stateOf(carrier).reveal, true, ':down entered');
  /** Exit off the TOP (box above viewport): the reader continued down — the reveal keeps. */
  dn.getBoundingClientRect = () => ({ top: -500, bottom: -100, left: 0, right: 0, width: 10, height: 400 });
  intersect(dn, false); await settled();
  assert.equal(stateOf(carrier).reveal, true, 'a top exit keeps the reveal');
  intersect(dn, true); await settled();
  /** Exit BELOW (box under viewport): the reader went back up — reset, so it replays. */
  dn.getBoundingClientRect = () => ({ top: 900, bottom: 1300, left: 0, right: 0, width: 10, height: 400 });
  intersect(dn, false); await settled();
  assert.equal(stateOf(carrier).reveal, false, 'a bottom exit resets — omni\'s shipped directional latch');
  host.remove();
  await settled();
});

test('in-view dispatches vera:in-view — the trigger surface fetch composes with', async () => {
  const host = await mount(`
    <div data-vd-state="{ seen: false }">
      <p id="sentinel" data-vd-in-view="seen"></p>
    </div>`);
  const heard = [];
  host.addEventListener('vera:in-view', (e) => heard.push(e.detail.visible));
  const sentinel = host.querySelector('#sentinel');
  intersect(sentinel, true); await settled();
  intersect(sentinel, false); await settled();
  assert.deepEqual(heard, [true, false], 'one bubbling event per transition, detail carrying the answer');
  host.remove();
  await settled();
});

test('elect: the section MOST IN VIEW wins by ratio; ties go to document order; empty string seeds and clears', async () => {
  const host = await mount(`
    <div data-vd-state="{ toc: 'unseeded' }">
      <section id="s1" data-vd-elect="toc"></section>
      <section id="s2" data-vd-elect="toc"></section>
      <b data-vd-text="toc"></b>
    </div>`);
  const carrier = host.firstElementChild;
  assert.equal(stateOf(carrier).toc, '', 'seeded to the no-winner value at group birth');
  const [s1, s2] = host.querySelectorAll('section');

  intersect(s1, true, { intersectionRatio: 0.4 }); await settled();
  assert.equal(stateOf(carrier).toc, 's1', 'the only visible section wins');
  intersect(s2, true, { intersectionRatio: 0.8 }); await settled();
  assert.equal(stateOf(carrier).toc, 's2', 'the MOST in view wins — ratio, not order');
  intersect(s2, true, { intersectionRatio: 0.4 }); await settled();
  assert.equal(stateOf(carrier).toc, 's1', 'a tie resolves to document order — the earlier section keeps it');
  intersect(s1, false); intersect(s2, false); await settled();
  assert.equal(stateOf(carrier).toc, '', 'nothing in view is the empty string, never a stale id');

  /** Teardown discipline: a departed section must not win forever. */
  intersect(s1, true, { intersectionRatio: 0.6 }); await settled();
  s1.remove(); await settled();
  assert.equal(stateOf(carrier).toc, '', 'the departed winner\'s tally row died with it');
  host.remove();
  await settled();
});
