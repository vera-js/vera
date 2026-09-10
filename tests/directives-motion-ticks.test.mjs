/**
 * The tick door — stage 6's named-JS destination.
 *
 * `wireTicks({ name: fn })` registers what `tick: 'name'` in the attribute names; the attribute
 * NAMES a function and never contains one. These are the door's own guarantees: registration
 * semantics (first wins, junk refused), delivery (the tick sees the same number CSS sees, at the
 * write moment), containment (a throwing tick dies alone, once), and the `{ tick, setup }`
 * lifecycle (setup at activation, teardown at removal — the drawer-drop contract sequence rides).
 *
 * jsdom: value-level CSS claims live in the browser suites; the tick's own calls are JS and
 * fully observable here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'customElements', 'Node',
  'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent',
  'MutationObserver', 'CSSStyleSheet', 'getComputedStyle', 'IntersectionObserver', 'ResizeObserver']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, motion, wireTicks, settled, rejections } = await load('directives');

const seen = [];
let throws = 0;
let setups = 0;
let teardowns = 0;
wireDirectives([motion({ inertia: 0 })]);
wireTicks({
  probe: (el, p) => seen.push({ el, p }),
  thrower: () => { throws++; throw new Error('boom'); },
  lifecycled: {
    tick: () => {},
    setup: () => { setups++; return () => { teardowns++; }; },
  },
});

const mount = async (markup) => {
  const host = dom.window.document.createElement('div');
  host.innerHTML = markup;
  for (const el of host.children) {
    Object.defineProperty(el, 'offsetTop', { value: 300, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 200, configurable: true });
  }
  dom.window.document.body.appendChild(host);
  await settled();
  await new Promise((r) => setTimeout(r, 40));
  return host;
};

test('a tick-only element is a real shape: the function IS the animation, and it sees the number', async () => {
  const host = await mount(`<div data-vd-motion="{ tick: 'probe', scroll: '100%, 0%' }">x</div>`);
  const el = host.querySelector('div');

  assert.ok(seen.length > 0, 'the CONTROL: the tick actually ran');
  assert.equal(seen.at(-1).el, el, 'handed the element itself');
  const p = seen.at(-1).p;
  assert.ok(p > 0 && p <= 1, `progress in range, got ${p}`);
  /** The same number, same moment, as the variable write — one door, three destinations. */
  assert.equal(dom.window.getComputedStyle(el).getPropertyValue('--vm-p'), String(p),
    'the tick and the variable carry one number');
  assert.equal(rejections(el).length, 0, 'nothing refused');

  host.remove();
  await settled();
});

test('a throwing tick dies alone, once — no console storm, no page damage', async () => {
  const host = await mount(`
    <div id="bad" data-vd-motion="{ tick: 'thrower', scroll: '100%, 0%' }">x</div>
    <div id="good" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }">x</div>`);
  const bad = host.querySelector('#bad');

  assert.equal(throws, 1, 'called once, dead from that frame on');
  const reasons = rejections(bad);
  assert.ok(reasons.some((r) => r.code === 'motion-tick-threw'), 'reported where a GUI reads');
  if (!isProduction) assert.ok(reasons.some((r) => /boom/.test(r.message)), 'carrying the error');
  /** The neighbour is untouched — one bad tick costs its own element, never the page. */
  assert.match(host.querySelector('#good').getAttribute('data-vm-motion') ?? '', /^[0-9a-f]{8}$/);

  host.remove();
  await settled();
});

test('an unregistered name is refused by name, with the wiring line', async () => {
  const host = await mount(`<div data-vd-motion="{ tick: 'nobody' }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-tick-unknown'));
  if (!isProduction) assert.ok(reasons.some((r) => /wireTicks/.test(r.fix ?? r.message ?? '')), 'told how');
  host.remove();
  await settled();
});

test('a { tick, setup } module gets its lifecycle: setup at activation, teardown at removal', async () => {
  const before = { setups, teardowns };
  const host = await mount(`<div data-vd-motion="{ tick: 'lifecycled', scroll: '100%, 0%' }">x</div>`);
  assert.equal(setups, before.setups + 1, 'setup ran once at activation');
  assert.equal(teardowns, before.teardowns, 'no teardown while alive');
  host.remove();
  await settled();
  assert.equal(teardowns, before.teardowns + 1, 'teardown ran when the element left');
});

test('registration is first-wins and junk is refused, both reported', async () => {
  const countBefore = rejections().length;
  wireTicks({ probe: () => {} });
  wireTicks({ junk: 42 });
  const added = rejections().slice(countBefore);
  assert.ok(added.some((r) => r.code === 'motion-tick-redefined'), 'a taken name is refused');
  assert.ok(added.some((r) => r.code === 'motion-tick-not-function'), 'a non-function is refused');
});

test('a bad tick VALUE is refused as grammar — parentheses are code, and code never rides an attribute', async () => {
  const host = await mount(`<div data-vd-motion="{ keyframes: { opacity: '0, 1' }, tick: 'alert(1)' }">x</div>`);
  const reasons = rejections(host.querySelector('div'));
  assert.ok(reasons.some((r) => r.code === 'motion-setting-tick'), JSON.stringify(reasons.map((r) => r.code)));
  host.remove();
  await settled();
});

test('tick beside keyframes: both destinations fire from one number', async () => {
  const before = seen.length;
  const host = await mount(
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, tick: 'probe', scroll: '100%, 0%' }">x</div>`);
  const el = host.querySelector('div');
  assert.match(el.getAttribute('data-vm-motion') ?? '', /^[0-9a-f]{8}$/, 'the CSS half generated');
  assert.ok(seen.length > before, 'and the tick half ran beside it');
  host.remove();
  await settled();
});
