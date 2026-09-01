/**
 * When an element ref is released, and when it deliberately is not.
 *
 * Two paths look identical to a reader and are not the same to the renderer:
 *
 * - a **subtree rendered away** releases the ref (`.value = null`, a function ref called with
 *   `null`), because the part that owned it was cleared;
 * - a **component removed from the document** does not, and `box.value` keeps pointing at the
 *   element, now detached.
 *
 * The asymmetry is a decision. A disconnect here is not a destruction: moving a node between parents
 * fires one, and the component renders again on reconnect — so releasing would blank every ref for
 * the frame a move takes to finish, and `_release` sets `_committed = UNSET`, so the re-apply could
 * only land on the following pass. The current behaviour costs a stale value that `isConnected`
 * already answers; the alternative costs a transient `null` on an operation people do on purpose.
 *
 * Asserted in both directions so that if it ever changes, someone changed it.
 */
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';

const dom = new JSDOM('<!doctype html><body><div id="a"></div><div id="b"></div></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { html, init, render, createStore, ref, wire } = core;
const { renderer, renderInto } = await load('renderer');
wire([renderer]);

const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const a = document.getElementById('a');
const b = document.getElementById('b');
let seq = 0;

test('a subtree rendered away releases its ref', () => {
  const box = ref();
  const state = createStore({ show: true });
  const draw = () => html`<div>${state.show ? html`<i ${box}>x</i>` : 'gone'}</div>`;
  const container = document.createElement('div');
  renderInto(draw(), container);
  assert.equal(box.value?.localName, 'i');
  state.show = false;
  renderInto(draw(), container);
  assert.equal(box.value, null, 'clearing the subtree must hand the ref back');
  state.show = true;
  renderInto(draw(), container);
  assert.equal(box.value?.localName, 'i', 'and bringing it back must fill it again');
});

test('a function ref is called with null when its subtree goes', () => {
  const seen = [];
  const state = createStore({ show: true });
  const draw = () => html`<div>${state.show ? html`<i ${(el) => seen.push(el === null ? null : el.localName)}>x</i>` : 'gone'}</div>`;
  const container = document.createElement('div');
  renderInto(draw(), container);
  state.show = false;
  renderInto(draw(), container);
  assert.deepEqual(seen, ['i', null]);
});

test('removing the component does not release the ref, and the element is simply detached', async () => {
  const box = ref();
  const tag = `x-reflife-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() { init(this, { mode: 'open' }); render(() => html`<i ${box}>x</i>`); }
  });
  const element = document.createElement(tag);
  a.appendChild(element);
  await settle();
  assert.equal(box.value?.localName, 'i');
  element.remove();
  await settle();
  assert.equal(box.value?.localName, 'i', 'the ref still points at its element');
  assert.equal(box.value.isConnected, false, 'which `isConnected` answers for');
});

test('which is what keeps a move from blanking it', async () => {
  const box = ref();
  const state = createStore({ n: 1 });
  const tag = `x-reflife-${seq++}`;
  let renders = 0;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => { renders++; return html`<i ${box}>${state.n}</i>`; });
    }
  });
  const element = document.createElement(tag);
  a.appendChild(element);
  await settle();
  const first = renders;

  /** A move is a disconnect and a connect. The ref must stay usable across it. */
  b.appendChild(element);
  assert.equal(box.value?.localName, 'i', 'the ref went null part-way through a move');
  await settle();
  assert.ok(renders > first, 'reconnecting renders again');
  assert.equal(box.value?.localName, 'i');

  /** And the component is still live afterwards. */
  state.n = 9;
  await settle();
  assert.equal(element.shadowRoot.textContent.trim(), '9');
});

/** Retention itself is measured in `tests/browser/memory.test.js`, where it can be trusted —
 * jsdom keeps bookkeeping of its own and reports removed nodes as retained that a real engine
 * collects, so a leak assertion here would be answering a different question. */
test('a ref created inside its component is not shared between instances', async () => {
  const boxes = [];
  const tag = `x-reflife-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const box = ref();
      boxes.push(box);
      render(() => html`<i ${box}>x</i>`);
    }
  });
  a.appendChild(document.createElement(tag));
  a.appendChild(document.createElement(tag));
  await settle();
  assert.equal(boxes.length, 2);
  assert.notEqual(boxes[0].value, boxes[1].value, 'each instance filled its own ref');
  void isProduction;
});
