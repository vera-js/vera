/**
 * **`__proto__` is refused at the props RECEIVERS** (D21, 2026-11-10): `element.__proto__ = v` replaces the element's
 * prototype, and `JSON.parse` makes `__proto__` an ordinary own key of a props bag. The receivers are the choke point:
 * shared-utils' `adoptProperty` (every renderer and spread delivery) and core's `adopt` (the `_$props$` drain, a field any
 * module can write). Both rows reach the receiver with every upstream guard bypassed. PIN: the entry points upstream
 * (a template `.__proto__` binding, a spread bag key, `props()`) still refuse it before it gets there; JSX's is D23's row.
 * CONTROL: an ordinary key in the same bag is delivered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const { html, init, wire, flush } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { spread, props } = await load('renderer/spread');
const { adoptProperty } = await import(`../packages/shared-utils/dist/${isProduction ? 'vera-shared-utils.min.js' : 'development/vera-shared-utils.js'}`);
wire([renderer]);
const quiet = (run) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return run(); } finally { console.warn = warn; }
};

test('adoptProperty, called directly (no renderer in front): `__proto__` is refused, the prototype kept', () => {
  const el = document.createElement('div');
  const proto = Object.getPrototypeOf(el);
  assert.equal(adoptProperty(el, '__proto__', { polluted: 1 }), 2, 'refused');
  assert.equal(Object.getPrototypeOf(el), proto);
  assert.equal(el.polluted, undefined);
  assert.equal(adoptProperty(el, 'item', 7), 1, 'CONTROL: an ordinary key is delivered (an upgraded element)');
  assert.equal(el.item, 7);
});

test('core adopt, through a `_$props$` record written directly (JSON-parsed): `__proto__` is not adopted', async () => {
  class Host extends HTMLElement {
    connectedCallback() { init(this, () => () => html`<p></p>`); }
  }
  customElements.define('proto-host', Host);
  const el = document.createElement('proto-host');
  el._$props$ = JSON.parse('{"__proto__": {"polluted": 1}, "item": 2}');
  document.body.append(el);
  await flush();
  assert.ok(el instanceof Host, 'the prototype is the class');
  assert.equal(el.polluted, undefined);
  assert.equal(el.item, 2, 'CONTROL: the ordinary key was adopted');
  el.remove();
});

test('PIN: a template binding, a spread bag key and props() still refuse `.__proto__` upstream', async () => {
  const host = document.createElement('div');
  const view = (v) => html`<x-proto .__proto__=${v}></x-proto>`;
  quiet(() => renderInto(view({ polluted: 1 }), host));
  await flush();
  const a = host.querySelector('x-proto');
  assert.equal(a.polluted, undefined, 'template binding refused');
  const viaSpread = (bag) => html`<x-proto ${spread(bag)}></x-proto>`;
  quiet(() => renderInto(viaSpread(JSON.parse('{".__proto__": {"polluted": 1}}')), host));
  await flush();
  assert.equal(host.querySelector('x-proto').polluted, undefined, 'spread bag key refused');
  const viaProps = (bag) => html`<x-proto ${props(bag)}></x-proto>`;
  quiet(() => renderInto(viaProps(JSON.parse('{"__proto__": {"polluted": 1}}')), host));
  await flush();
  assert.equal(host.querySelector('x-proto').polluted, undefined, 'props() key refused');
  /** JSX: its `__proto__` prop is mis-transformed today (an attribute named `[object Object]`), a row of its own (D23). */
});
