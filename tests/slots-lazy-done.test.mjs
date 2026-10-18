/**
 * **Slots' render-end hook is installed at its first need** (A19, 2026-10-18). With slots wired but nothing slotted yet,
 * the renderer's `_$done$` read finds `undefined`, and every render ends without calling into slots (Firefox plain
 * creation −4.4%). The first light host, the first host a template feeds, the first park, or the first render of a
 * dashed element already holding content arms it, and from then on it runs as before.
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

const { init, html, wire, flush } = await load('core');
const { renderer } = await load('renderer');
const { slots } = await load('renderer/slots');
let registry;
wire([renderer, slots, (r) => { registry = r; }]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

customElements.define('ld-plain', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<p>plain</p>`); }
});
customElements.define('ld-card', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<em><slot>none</slot></em>`); }
});

test("plain components with slots wired never install the render-end hook; the first light host does", async () => {
  assert.ok(registry._$capture$ !== undefined, 'CONTROL: slots is wired');
  for (let i = 0; i < 10; i++) document.body.append(document.createElement('ld-plain'));
  flush();
  await settle();
  assert.equal(document.querySelectorAll('ld-plain p').length, 10, 'CONTROL: they rendered');
  assert.equal(registry._$done$, undefined, 'no render-end hook while nothing needs slotting');
  const card = document.createElement('ld-card');
  card.append(document.createElement('b'));
  document.body.append(card);
  flush();
  await settle();
  assert.equal(typeof registry._$done$, 'function', 'armed by the first light host');
  assert.ok(card.querySelector('em b') !== null, 'and it distributes');
});
