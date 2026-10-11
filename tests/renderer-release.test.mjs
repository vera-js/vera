/**
 * **A removed component's part is RELEASED** (work queue 0d, 2026-10-11). Core's teardown asks the renderer to drop every
 * user value the component's part holds — event handlers, committed values, nested parts — so the removed DOM keeps no
 * path back into the component's JS. With handlers that capture `host`, that cycle cost Firefox's cycle collector 20 s on
 * a churn page against vanilla `addEventListener`'s 1 s; released, 0.5 s (measured with Firefox's profiler — the CC is
 * not unit-testable, so these rows pin the BEHAVIOR around it):
 * - a re-added component renders exactly once, with working handlers and reactivity;
 * - a removed element keeps its DOM (code holding it — an exit animation, a drag preview — still sees it);
 * - a removed component's handler no longer runs;
 * - with hydration wired, a re-added component is never taken for server markup;
 * - a keep-alive move is not a removal: nothing is released.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
const { init, html, wire, createStore, inserts } = await load('core');
const { renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
wire([renderer, hydration]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;

/** A component whose paragraph's click handler captures `host` — the shape that formed the cycle. */
const define = (clicks, store) => {
  const tag = `rr-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init(this, (host) => () => html`<p @click=${() => clicks.push(host.localName)}>${store.n}</p>`);
    }
  });
  return tag;
};

test('a re-added component renders exactly once — handlers work, writes repaint', async () => {
  const clicks = [];
  const store = createStore({ n: 1 });
  const el = doc.createElement(define(clicks, store));
  doc.body.append(el);
  await tick();
  assert.equal(el.querySelectorAll('p').length, 1, 'CONTROL: rendered once');
  el.remove();
  await tick();
  doc.body.append(el);
  await tick();
  assert.equal(el.querySelectorAll('p').length, 1, 'once after the re-add — never a second copy');
  el.querySelector('p').click();
  assert.equal(clicks.length, 1, 'the re-added handler runs');
  store.n = 2;
  await tick();
  assert.equal(el.textContent, '2', 'and a write repaints it');
  el.remove();
});

test('a removed element keeps its DOM, and its handler no longer runs', async () => {
  const clicks = [];
  const store = createStore({ n: 7 });
  const el = doc.createElement(define(clicks, store));
  doc.body.append(el);
  await tick();
  const p = el.querySelector('p');
  p.click();
  assert.equal(clicks.length, 1, 'CONTROL: the handler runs while connected');
  el.remove();
  await tick();
  assert.equal(el.textContent, '7', 'the removed element still shows its content');
  p.click();
  assert.equal(clicks.length, 1, 'released: the removed handler is not called');
});

test('an event on a released element is harmless — nothing throws, nothing reaches the error chain', async () => {
  const reported = [];
  const handler = (error) => reported.push(error);
  wire({ on: 'error', fn: handler, priority: 77 });
  const thrown = [];
  const onError = (event) => thrown.push(event.error ?? event.message);
  dom.window.addEventListener('error', onError);
  try {
    const clicks = [];
    const el = doc.createElement(define(clicks, createStore({ n: 1 })));
    doc.body.append(el);
    await tick();
    const p = el.querySelector('p');
    el.remove();
    await tick();
    p.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    p.click();
    await tick();
    assert.equal(clicks.length, 0, 'the released handler is not called');
    assert.deepEqual(thrown, [], 'no listener threw');
    assert.deepEqual(reported, [], 'nothing reported to the error chain');
  } finally {
    dom.window.removeEventListener('error', onError);
    const chain = inserts.get('error');
    const at = chain.indexOf(handler);
    chain.splice(at, 1);
    chain._p.splice(at, 1);
  }
});

test('with hydration wired, a re-added component is rendered, never adopted as server markup', async () => {
  const clicks = [];
  const store = createStore({ n: 3 });
  const el = doc.createElement(define(clicks, store));
  doc.body.append(el);
  await tick();
  el.remove();
  await tick();
  store.n = 4;
  doc.body.append(el);
  await tick();
  assert.equal(el.textContent, '4', 'the current value, rendered fresh — not the stale removed markup kept as it was');
  assert.equal(el.querySelectorAll('p').length, 1);
  el.remove();
});

test('a keep-alive move is not a removal — nothing is released', async () => {
  const clicks = [];
  const store = createStore({ n: 5 });
  const el = doc.createElement(define(clicks, store));
  const a = doc.createElement('div');
  const b = doc.createElement('div');
  doc.body.append(a, b);
  a.append(el);
  await tick();
  const p = el.querySelector('p');
  b.append(el);
  await tick();
  assert.equal(el.querySelector('p'), p, 'the same paragraph — nothing rebuilt');
  p.click();
  assert.equal(clicks.length, 1, 'its handler still runs');
  store.n = 6;
  await tick();
  assert.equal(el.textContent, '6', 'and it is still subscribed');
  a.remove();
  b.remove();
});
