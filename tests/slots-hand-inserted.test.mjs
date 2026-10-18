/**
 * **A `<slot>` inserted BY HAND takes part on an `observeSlots: 'eager'` component, as natively** (KNOWN fix, Brian's
 * option 3, 2026-10-18): it is claimed like the template's own, takes the assignment by tree order, and removing it hands
 * it back. A `<slot>` inside the host's LIGHT content is light DOM, not a slot of this host, and is left alone. A
 * component observed lazily (the default) does not follow hand-inserted slots: that stays a listed known difference,
 * and it costs those components nothing (no scan of added nodes).
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
wire([renderer, slots]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

customElements.define('hi-card', class extends HTMLElement {
  connectedCallback() { init({ host: this, observeSlots: 'eager' }, () => () => html`<header></header><main><slot name="h">fh</slot></main>`); }
});
/** The same component observed lazily (the default): hand-inserted slots are not followed. */
customElements.define('hi-lazy', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<header></header><main><slot name="h">fh</slot></main>`); }
});
const make = async (children = [], tag = 'hi-card') => {
  const el = document.createElement(tag);
  const b = document.createElement('b');
  b.setAttribute('slot', 'h');
  b.textContent = 'B';
  el.append(b, ...children);
  document.body.append(el);
  flush();
  await settle();
  assert.equal(el.querySelector('main b'), b, "CONTROL: the template's slot holds it");
  return { el, b };
};

test('a same-named slot inserted by hand EARLIER in tree order takes the assignment; removed again, it hands it back', async () => {
  const { el, b } = await make();
  const hand = document.createElement('slot');
  hand.setAttribute('name', 'h');
  el.querySelector('header').append(hand);
  flush();
  await settle();
  assert.equal(el.querySelector('header b'), b, `the first in tree order takes it: ${el.innerHTML}`);
  assert.equal(b.assignedSlot, hand, 'and assignedSlot names it');
  hand.remove();
  flush();
  await settle();
  assert.equal(el.querySelector('main b'), b, `handed back to the template's slot: ${el.innerHTML}`);
  el.remove();
});

test("a <slot> inside the host's LIGHT content is light DOM, not a slot of this host: left alone", async () => {
  const wrap = document.createElement('div');
  const { el } = await make([wrap]);
  const inner = document.createElement('slot');
  wrap.append(inner);
  flush();
  await settle();
  assert.equal(inner.assignedNodes().length, 0, 'not claimed: it takes nothing');
  assert.equal(inner.$rec, undefined, 'and carries no slots record');
  el.remove();
});

test("a LAZY component (the default) does not follow a slot inserted by hand: the known difference, and the eager row's control", async () => {
  const { el, b } = await make([], 'hi-lazy');
  const hand = document.createElement('slot');
  hand.setAttribute('name', 'h');
  el.querySelector('header').append(hand);
  flush();
  await settle();
  assert.equal(el.querySelector('main b'), b, `the template's slot keeps it: ${el.innerHTML}`);
  assert.equal(hand.$rec, undefined, 'and the hand-inserted slot carries no slots record');
  el.remove();
});
