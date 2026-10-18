/**
 * **`static observeSlots = true`** (2026-10-17): that component is observed from its first render, as native shadow DOM
 * follows every host — so a child appended BY HAND before it has rendered a slot is hidden (light content), where a
 * component without it shows the child until a slot renders (`tests/slots-pay-on-need.test.mjs`). Only the component
 * that asks pays: a plain one beside it still makes no observer registration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'ShadowRoot', 'CSSStyleSheet', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { init, html, wire, ref, flush } = await load('core');
const { renderer } = await load('renderer');
const { slots } = await load('renderer/slots');

wire([renderer, slots]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const open = ref(false);
let observes = 0;
const observe = dom.window.MutationObserver.prototype.observe;
dom.window.MutationObserver.prototype.observe = function (...args) {
  observes++;
  return observe.apply(this, args);
};
customElements.define('oa-plain', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<p>plain</p>`); }
});
customElements.define('oa-late', class extends HTMLElement {
  static observeSlots = true;
  connectedCallback() { init(this, () => () => html`<main>${open.value ? html`<em><slot>fallback</slot></em>` : null}</main>`); }
});

test('observeSlots — a child appended by hand to an empty slotless component is hidden, then slotted once a slot renders', async () => {
  const el = document.createElement('oa-late');
  document.body.append(el);
  flush();
  await settle();
  const child = document.createElement('b');
  child.textContent = 'LIGHT';
  el.append(child);
  flush();
  await settle();
  assert.equal(child.parentNode !== el && el.querySelector('main').textContent === '', true, `hidden, as native: ${el.innerHTML}`);
  open.value = true;
  flush();
  await settle();
  assert.equal(el.querySelector('em')?.textContent, 'LIGHT', `slotted once a slot renders: ${el.innerHTML}`);
  assert.ok(el.querySelector('main')?.parentNode === el, "the component's own content is not swallowed");
  el.remove();
});

test('a plain component beside it still pays nothing — CONTROL: the opted-in one registers', async () => {
  const before = observes;
  const plain = document.createElement('oa-plain');
  document.body.append(plain);
  flush();
  await settle();
  assert.equal(observes - before, 0, 'observe() calls for a plain component');
  const opted = document.createElement('oa-late');
  document.body.append(opted);
  flush();
  await settle();
  assert.ok(observes - before > 0, 'the opted-in component is observed from its first render, slot or not');
  plain.remove();
  opted.remove();
});
