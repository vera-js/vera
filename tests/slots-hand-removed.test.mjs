/**
 * **A `<slot>` removed BY HAND unassigns its content, as natively** (KNOWN fix, 2026-10-18). A FILLED slot has stepped
 * out of the page (its region stands in its place), so its own `remove()` / `replaceWith()` put its content back to
 * holding first; any other removal — the slot showing fallback, its parent, an ancestor — is found by the host's own
 * observer (a microtask later). The content then shows in the next slot of that name in tree order, or nowhere. The
 * template's own teardown and a `hold()` park are not removals by hand.
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

let refs = {};
const ref = (key) => (el) => { if (el) refs[key] = el; };
customElements.define('hr-two', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<header><slot name="h" &ref=${ref('first')}>f1</slot></header><aside><slot name="h" &ref=${ref('second')}>f2</slot></aside><main><slot &ref=${ref('d')}>fd</slot></main>`); }
});
const make = async () => {
  refs = {};
  const el = document.createElement('hr-two');
  const b = document.createElement('b');
  b.setAttribute('slot', 'h');
  b.textContent = 'B';
  el.append(b, 'text');
  document.body.append(el);
  flush();
  await settle();
  assert.equal(el.querySelector('header b'), b, 'CONTROL: the first same-named slot holds it');
  return { el, b };
};

test("a filled slot's remove(): its content goes to the next slot of that name", async () => {
  const { el, b } = await make();
  refs.first.remove();
  flush();
  await settle();
  assert.equal(el.querySelector('aside b'), b, `the next same-named slot takes it: ${el.innerHTML}`);
  assert.equal(el.querySelector('header').textContent, '', 'the removed slot shows nothing');
  el.remove();
});

test("a filled slot's replaceWith(): replaced, and its content reassigned", async () => {
  const { el, b } = await make();
  const u = document.createElement('u');
  u.textContent = 'U';
  refs.first.replaceWith(u);
  flush();
  await settle();
  assert.equal(el.querySelector('header u'), u, 'the replacement stands where the slot was');
  assert.equal(el.querySelector('aside b'), b, `reassigned: ${el.innerHTML}`);
  el.remove();
});

test("removing a slot's parent unassigns its content: the default slot's text then shows nowhere", async () => {
  const { el } = await make();
  el.querySelector('main').remove();
  flush();
  await settle();
  const shown = [...el.childNodes].filter((n) => !(n.nodeType === 1 && n.hasAttribute('data-vm-unassigned'))).map((n) => n.textContent).join('');
  assert.equal(shown.includes('text'), false, `unassigned, so not shown: ${el.innerHTML}`);
  assert.ok(el.querySelector('ins[data-vm-unassigned]')?.textContent.includes('text'), 'it waits in holding');
  el.remove();
});

test('removing both same-named slots: their content shows nowhere', async () => {
  const { el, b } = await make();
  refs.first.remove();
  refs.second.remove();
  flush();
  await settle();
  assert.equal(b.isConnected && el.contains(b) && b.closest('ins[hidden]') === null, false, `not shown: ${el.innerHTML}`);
  el.remove();
});
