/**
 * **What a root's renders fed stays bounded by its live rows** (2026-10-18). Slots records, per render root, every
 * custom element its templates created WITH children (`FED`, so an outer template's change to a host's children is
 * distributed by the end of that render). An entry used to leave only when its element was collected, so a churned list
 * of slotted rows re-filtered a growing array on every render. A host that left a connected root is dropped at the
 * root's next render now. And a host put back BY HAND is still followed, by its own observer from its first slot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'ShadowRoot', 'CSSStyleSheet', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const core = await load('core');
const { init, html, wire, flush } = core;
const { renderer, renderInto } = await load('renderer');
const { slots } = await load('renderer/slots');
let fedOf = () => 0;
wire([renderer, slots, (r) => { fedOf = (root) => r._$slotsFed$?.(root) ?? -1; }]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

customElements.define('fg-card', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<em><slot>none</slot></em>`); }
});
const list = (items) => html`${items.map((t) => html`<fg-card>${t}</fg-card>`)}`;

test('a churned list of slotted rows: what its root has fed stays bounded by the rows live at its last render', { skip: isProduction && 'the count is a development probe' }, async () => {
  const root = document.createElement('div');
  document.body.append(root);
  const rows = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}`);
  renderInto(list(rows(10, 'a')), root);
  flush();
  await settle();
  assert.equal(fedOf(root), 10, 'CONTROL: ten fed rows recorded');
  for (let round = 0; round < 20; round++) {
    renderInto(list([]), root);
    renderInto(list(rows(10, `r${round}-`)), root);
    flush();
    await settle();
  }
  assert.ok(fedOf(root) <= 20, `bounded (live rows plus those removed since the root's last render): ${fedOf(root)}`);
  assert.equal(root.querySelector('fg-card em')?.textContent, 'r19-0', 'the rows still distribute');
  root.remove();
});

test('a fed host removed by hand and put back under the same root still shows what the outer template writes into it', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  renderInto(list(['one']), root);
  flush();
  await settle();
  const card = root.querySelector('fg-card');
  assert.equal(card.querySelector('em')?.textContent, 'one', 'CONTROL: distributed');
  const anchor = card.nextSibling;
  card.remove();
  renderInto(list(['one']), root);
  flush();
  await settle();
  root.insertBefore(card, anchor);
  flush();
  await settle();
  renderInto(list(['two']), root);
  flush();
  await settle();
  assert.equal(card.querySelector('em')?.textContent, 'two', `followed after its observer's microtask: ${card.innerHTML}`);
  root.remove();
});
