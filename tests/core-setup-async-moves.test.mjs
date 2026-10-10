/**
 * **An async setup across a move** (vera-5a's point 2): core's keep-alive skips the author's `connectedCallback` for a
 * move within its document — with `moveBefore` and with a plain `insertBefore` — so a PENDING async setup survives a
 * reorder: one setup, and its render lands. A move into ANOTHER document is a teardown and a fresh setup: the first
 * setup's late settle is dropped by its generation, and the second renders.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><iframe></iframe></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver'])
  globalThis[k] = dom.window[k];
const { html, wire, init, createStore, useEffect, useLayoutEffect } = await load('core');
const { renderer, renderInto } = await load('renderer');
wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const box = () => { const d = doc.createElement('div'); doc.body.append(d); return d; };

/** Each setup waits on its own gate, so a row decides when each settles. */
const gates = [];
let setups = 0;
customElements.define('as-kid', class extends dom.window.HTMLElement {
  connectedCallback() {
    init(this, async () => {
      const n = ++setups;
      await new Promise((resolve) => gates.push(resolve));
      return () => html`<i>setup ${n}</i>`;
    });
  }
});

for (const [how, move] of [
  ['insertBefore', (kid, to) => to.insertBefore(kid, null)],
  ['moveBefore', (kid, to) => (typeof to.moveBefore === 'function' ? to.moveBefore(kid, null) : to.insertBefore(kid, null))],
])
  test(`a pending async setup survives a move in its document (${how}): one setup, and its render lands`, async () => {
    setups = 0;
    gates.length = 0;
    const kid = doc.createElement('as-kid');
    box().append(kid);
    await tick();
    move(kid, box());
    await tick();
    assert.equal(setups, 1, 'the move did not set it up again');
    gates.shift()();
    await tick();
    await tick();
    assert.equal(kid.textContent, 'setup 1', 'the pending setup\'s render landed');
  });

test('a move into ANOTHER document: the first settle is dropped, the second setup renders', async () => {
  setups = 0;
  gates.length = 0;
  const kid = doc.createElement('as-kid');
  box().append(kid);
  await tick();
  doc.querySelector('iframe').contentDocument.body.append(kid);
  await tick();
  assert.equal(setups, 2, 'CONTROL: set up again in the other document');
  gates.shift()(); // the FIRST setup settles late
  await tick();
  await tick();
  assert.notEqual(kid.textContent, 'setup 1', 'the stale settle was dropped');
  gates.shift()();
  await tick();
  await tick();
  assert.equal(kid.textContent, 'setup 2', 'the second setup renders');
});

/**
 * **What a throwing setup registered stays inert, even when no next connect resets it** (vera-5a): a same-document
 * move skips the author's `connectedCallback`, so nothing re-inits. The hooks were never committed — no first pass, so
 * no subscription — and nothing a later write or a parent's re-render does reaches them. (Why `init` keeps no discard:
 * one was mutation-proven unobservable; this row is what an undiscarded hook must keep doing.)
 */
test('a throwing setup, then a same-document move, a store write and a parent re-render: nothing it registered runs', async () => {
  const shared = createStore({ v: 0 });
  const ran = [];
  customElements.define('as-throws', class extends dom.window.HTMLElement {
    connectedCallback() {
      try {
        init(this, () => {
          useEffect(() => { ran.push(`effect ${shared.v}`); });
          useLayoutEffect(() => { ran.push(`layout ${shared.v}`); });
          throw new Error('setup boom');
        });
      } catch { /* the author's own call failed */ }
    }
  });
  const parent = box();
  const renderParent = (n) => renderInto(html`<p>${n}</p>${kid}`, parent);
  const kid = doc.createElement('as-throws');
  renderParent(0);
  await tick();
  assert.ok(kid.isConnected, 'CONTROL: connected, its setup threw');
  box().insertBefore(kid, null); // a same-document move: no re-init
  await tick();
  shared.v = 1;
  await tick();
  renderParent(1);
  await tick();
  assert.deepEqual(ran, [], 'nothing it registered ever ran');
});

