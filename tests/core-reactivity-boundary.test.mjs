/**
 * Which values a store proxies, and which it hands back untouched.
 *
 * `createStore` is documented as a "deep reactive proxy", and a reader is entitled to take that
 * literally — so the boundary has to be written down and held. It is not arbitrary: the types on the
 * far side carry their state in **internal slots** rather than in properties, so a proxy cannot
 * observe a change to them and in several cases cannot even be called on one. That is the same
 * reason `@verajs/reactivity/collections` has to re-bind `Map` and `Set` methods.
 *
 * There is deliberately no runtime warning. A `Date` read to format it is far more common than a
 * `Date` read to mutate it, so a warning would fire on the ordinary case — which is why this is a
 * documented boundary and a test rather than a diagnostic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element'])
  globalThis[key] = dom.window[key];

const core = await load('core');

const PROXIED = {
  'plain object': () => ({}),
  array: () => [],
  Map: () => new Map(),
  Set: () => new Set(),
  WeakMap: () => new WeakMap(),
  WeakSet: () => new WeakSet(),
  'class instance': () => new (class {})(),
  'null-prototype object': () => Object.create(null),
};

const RAW = {
  Date: () => new Date(),
  RegExp: () => /x/,
  Promise: () => Promise.resolve(),
  Error: () => new Error('x'),
  URL: () => new URL('https://x.test'),
  URLSearchParams: () => new URLSearchParams(),
  Uint8Array: () => new Uint8Array(1),
  ArrayBuffer: () => new ArrayBuffer(1),
  DataView: () => new DataView(new ArrayBuffer(1)),
  function: () => () => {},
  'DOM element': () => document.createElement('div'),
};

test('these are proxied, so mutating them is visible', () => {
  for (const [name, make] of Object.entries(PROXIED)) {
    const value = make();
    const state = core.createStore({ value });
    assert.notEqual(state.value, value, `${name} should be proxied`);
  }
});

test('these are handed back exactly as they went in', () => {
  for (const [name, make] of Object.entries(RAW)) {
    const value = make();
    const state = core.createStore({ value });
    assert.equal(state.value, value, `${name} should not be proxied`);
  }
});

/**
 * The consequence, stated as a behaviour rather than an implementation note: mutating one of these
 * in place changes it and renders nothing, and replacing it renders.
 */
test('mutating a Date in place does not notify; replacing it does', async () => {
  const element = document.createElement('div');
  document.body.append(element);
  core.init(element, { mode: 'open' });
  const state = core.createStore({ when: new Date(0) });

  const seen = [];
  core.createHook({ element, priority: 50, callback: () => seen.push(state.when.getTime()) });
  element._hooks?.forEach((set) => set.forEach((callback) => callback(undefined, true)));
  const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

  state.when.setUTCFullYear(1999);
  await frame();
  assert.equal(seen.length, 1, 'an in-place mutation writes no property, so nothing re-runs');

  state.when = new Date(86_400_000);
  await frame();
  assert.equal(seen.length, 2, 'replacing it is a write to `when`');
  assert.equal(seen[1], 86_400_000);
});
