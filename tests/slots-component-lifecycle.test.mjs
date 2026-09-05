/**
 * A STATEFUL component inside slotted content, across displacement — the divergence the README's
 * differences list now names: native distribution is virtual (an unassigned slottable stays
 * connected), light slots park physically (disconnect on the way out, reconnect on return).
 *
 * What must hold, and what this pins:
 *  - the ledger balances at every stage — effects minus cleanups equals live effects: 1 while
 *    connected, 0 while parked. An imbalance in either direction is a defect (double
 *    registration or a cleanup that never ran);
 *  - the roundtrip preserves element identity, so the store and everything hanging off the
 *    instance survive;
 *  - reactivity is LIVE after restore — the re-init subscribes again, and a write renders. A
 *    component that comes back frozen passes every static comparison, which is why the write
 *    happens after the roundtrip;
 *  - the plain-move control isolates blame: appendChild-elsewhere is the same
 *    disconnect/connect pair with no slots involved, so a control failure is core's re-entry
 *    story, not parking's.
 *
 * The counters include the distribution move itself: appending a slottable to a light host and
 * rendering a slot for it MOVES the node into the slot's region, which is one extra
 * disconnect/connect pair before anything is displaced. The assertions therefore check balance
 * and deltas, never absolute totals — absolute totals would pin the number of internal moves,
 * which is an implementation detail the mutation fuzz already covers from the outside.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'Event',
  'CustomEvent', 'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame',
  'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];

const { html, init, render, createStore, useEffect, wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots } = await load('renderer/slots');
wire([renderer, slots]);
const doc = dom.window.document;
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));

let effectRuns = 0, cleanups = 0;
class StatefulItem extends HTMLElement {
  connectedCallback() {
    init(this);
    this.store ??= createStore({ n: 0 });
    useEffect(() => { void this.store.n; effectRuns++; return () => cleanups++; });
    render(() => html`<b>n=${this.store.n}</b>`);
  }
}
customElements.define('stateful-item', StatefulItem);
const live = () => effectRuns - cleanups;

test('a plain move re-enters cleanly — the control that isolates blame', async () => {
  const a = doc.createElement('div'); const b = doc.createElement('div');
  doc.body.append(a, b);
  const el = doc.createElement('stateful-item');
  a.append(el); await frame();
  el.store.n = 1; await frame();
  assert.ok(el.textContent.includes('n=1'), 'CONTROL: the component renders at all');
  assert.equal(live(), 1, 'one live effect while connected');

  b.append(el); await frame();
  el.store.n = 2; await frame();
  assert.ok(el.textContent.includes('n=2'), 'reactive after the move');
  assert.equal(el.store.n, 2, 'the instance store survived');
  assert.equal(live(), 1, 'still exactly one live effect — re-init did not double-register');
  a.remove(); b.remove();
});

test('the park roundtrip: cleanup out, re-init back, state kept, reactivity live', async () => {
  const host = doc.createElement('div');
  doc.body.append(host);
  const item = doc.createElement('stateful-item');
  item.setAttribute('slot', 'o');
  host.append(item);

  const drawSlot = () => html`<div><slot name="o">fall</slot></div>`;
  const drawAway = () => html`<p>away</p>`;

  renderInto(drawSlot(), host); await frame();
  item.store.n = 5; await frame();
  assert.ok(item.textContent.includes('n=5'), 'CONTROL: assigned and rendering');
  assert.equal(item.isConnected, true);
  assert.equal(live(), 1, 'one live effect while assigned');

  renderInto(drawAway(), host); await frame();
  assert.equal(item.isConnected, false, 'parked content is disconnected — the documented divergence');
  assert.equal(live(), 0, 'and its effect was cleaned up, not stranded');

  renderInto(drawSlot(), host); await frame();
  assert.equal(item.isConnected, true, 'restored');
  assert.equal(item.store.n, 5, 'element identity held, so the store did too');
  item.store.n = 7; await frame();
  assert.ok(item.textContent.includes('n=7'), 'reactive AFTER restore — the frozen-component case');
  assert.equal(live(), 1, 'exactly one live effect again');
});

test('the native oracle: an unassigned slottable never disconnects', () => {
  const shadowHost = doc.createElement('div');
  doc.body.append(shadowHost);
  const u = doc.createElement('u'); u.setAttribute('slot', 'o'); u.textContent = 'x';
  shadowHost.append(u);
  shadowHost.attachShadow({ mode: 'open' }).innerHTML = '<div><slot name="o">fall</slot></div>';
  assert.equal(u.isConnected, true);
  shadowHost.shadowRoot.innerHTML = '<p>away</p>';
  assert.equal(u.isConnected, true, 'no slot names it, and it is still connected — distribution is virtual');
});
