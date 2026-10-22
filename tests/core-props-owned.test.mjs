/**
 * **The props record's store keeps its proxy ON the record** (2026-10-22, `createOwned`): no WeakMap entry for a young,
 * runtime-built record. These rows pin that it is still ONE store — `createStore(record)` answers the same proxy, and a
 * write through either wakes a reader of the other — that the slot is invisible (no spread or `Object.keys` sees it, so
 * the removal's copy starts clean), and that a re-added element keeps its props.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, init, html, wire, createStore, flush, useEffect } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const settle = async () => { flush(); await new Promise((resolve) => setTimeout(resolve, 0)); flush(); };

test('ONE store: createStore(record) is the accessor\'s proxy, and a write through either wakes a reader of the other', async () => {
  define({ tag: 'x-own-one', props: { a: 1 } }, (host) => () => html`<b>${host.a}</b>`);
  const el = document.createElement('x-own-one');
  document.body.append(el);
  await settle();
  assert.equal(el.textContent, '1', 'CONTROL: the default rendered');
  const raw = el._$raw$;
  const viaStore = createStore(raw);
  assert.equal(viaStore, el._$v$, 'the same proxy');
  const seen = [];
  define('x-own-reader', () => { useEffect(() => { seen.push(viaStore.a); }); return () => html`<i></i>`; });
  const reader = document.createElement('x-own-reader');
  document.body.append(reader);
  await settle();
  el.a = 2;
  await settle();
  assert.equal(el.textContent, '2', 'the component heard the accessor write');
  assert.deepEqual(seen, [1, 2], 'a reader through createStore(record) heard the accessor write');
  viaStore.a = 3;
  await settle();
  assert.equal(el.textContent, '3', 'the component heard a write through createStore(record)');
  el.remove();
  reader.remove();
});

test('the slot is invisible: Object.keys and a spread of the record see only the props', async () => {
  define({ tag: 'x-own-keys', props: { a: 1, b: 2 } }, (host) => () => html`<b>${host.a}</b>`);
  const el = document.createElement('x-own-keys');
  document.body.append(el);
  await settle();
  const raw = el._$raw$;
  assert.deepEqual(Object.keys(raw), ['a', 'b']);
  assert.deepEqual(Object.getOwnPropertySymbols({ ...raw }), [], 'a spread copies no slot');
  assert.equal(Object.getOwnPropertySymbols(raw).length, 1, 'CONTROL: the record does carry its slot');
  el.remove();
});

test('removed and re-added: the props survive and stay reactive (the release copy gets its own store)', async () => {
  define({ tag: 'x-own-readd', props: { a: 1 } }, (host) => () => html`<b>${host.a}</b>`);
  const el = document.createElement('x-own-readd');
  document.body.append(el);
  await settle();
  el.a = 5;
  await settle();
  const before = el._$v$;
  el.remove();
  await settle();
  document.body.append(el);
  await settle();
  assert.equal(el.textContent, '5', 'the value survived');
  el.a = 6;
  await settle();
  assert.equal(el.textContent, '6', 'and is reactive again');
  assert.notEqual(el._$v$, before, 'CONTROL: the release built a new store over the copy');
  el.remove();
});

test('a class component with adopted props: one store over its record, which carries the slot', async () => {
  const state = createStore({ v: 7 });
  customElements.define('x-own-class', class extends HTMLElement {
    connectedCallback() { init(this, (host) => () => html`<b>${host.value}</b>`); }
  });
  define('x-own-parent', () => () => html`<x-own-class .value=${state.v}></x-own-class>`);
  const parent = document.createElement('x-own-parent');
  document.body.append(parent);
  await settle();
  const child = parent.shadowRoot?.querySelector('x-own-class') ?? parent.querySelector('x-own-class') ?? parent._$r$?.querySelector('x-own-class');
  assert.ok(child, 'CONTROL: the child exists');
  assert.equal(child.textContent, '7', 'the adopted prop rendered');
  assert.equal(createStore(child._$raw$), child._$v$, 'one store');
  assert.equal(Object.getOwnPropertySymbols(child._$raw$).length, 1, 'its record carries the slot');
  state.v = 8;
  await settle();
  assert.equal(child.textContent, '8', 'a new value from the parent repaints');
  parent.remove();
});
