/**
 * **A `<slot>` that appears LATER — in a nested template a condition renders — still takes the light children appended
 * meanwhile** (2026-10-17). No suite covered it, and it is exactly what an ownership shortcut breaks: owning a light root
 * whose template has no `<slot>` at its first render (probe "claim only hosts whose template has a slot") left slots no
 * render range to tell the component's nodes from its light children — the late slot threw (HierarchyRequestError) and
 * the component's own content was swallowed into the hidden holding element. A light root slots captured keeps its
 * range; this row holds that.
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

test('a slot rendered later by a condition shows the light child appended while it was absent', async () => {
  const open = ref(false);
  customElements.define('late-slot-host', class extends HTMLElement {
    connectedCallback() { init(this, () => () => html`<main>${open.value ? html`<em><slot>fallback</slot></em>` : null}</main>`); }
  });
  const errors = [];
  const saved = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const el = document.createElement('late-slot-host');
    document.body.append(el);
    flush();
    await settle();
    const child = document.createElement('b');
    child.textContent = 'LIGHT';
    el.append(child);
    flush();
    await settle();
    assert.ok(el.querySelector('main') !== null, 'CONTROL: the component rendered');
    assert.equal(el.querySelector('main').textContent, '', 'while there is no slot, the light child shows nowhere');
    open.value = true;
    flush();
    await settle();
    assert.equal(el.querySelector('em')?.textContent, 'LIGHT', `the late slot shows it: ${el.innerHTML}`);
    assert.ok(child.parentNode !== null && child.isConnected, 'connected, in the slot');
    assert.ok(el.querySelector('main') !== null && el.querySelector('main').parentNode === el, "the component's own content is not swallowed into holding");
    assert.deepEqual(errors, [], 'nothing reported');
    el.remove();
  } finally {
    console.error = saved;
  }
});
