/**
 * What a component *shows* after it comes back, which is not what lifecycle balance measures.
 *
 * `createProxy.ts` skips subscriptions for a disconnected element — `if (element?.isConnected ===
 * false) continue` — so a store write while a component is out of the tree renders nothing. That is a
 * deliberate optimisation: without it every write walks elements no one can see.
 *
 * It is only half a contract. The other half is that reconnecting **catches up**, and nothing asserted
 * it. `lifecycle-balance-fuzz` generates connect, disconnect, move and reconnect sequences, but its
 * oracle is arithmetic — every effect run balanced by exactly one cleanup. A component can satisfy
 * that perfectly while displaying a number from ten seconds ago.
 *
 * The catch-up is `connectedCallback` running again, which re-reads the store. So the skip is safe
 * *because* of a mechanism in a different file, and the pair is what has to hold together: skipping
 * without the catch-up is stale content, and catching up without the skip is wasted work on every
 * write in the application.
 *
 * The shapes are ordinary: a list reordered, a row dragged, a panel detached and re-inserted, a
 * component moved between parents.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="app"></div><div id="other"></div></body>', {
  url: 'https://x.test/',
  pretendToBeVisual: true,
});
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent', 'MutationObserver', 'ShadowRoot',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
const { html } = await load('renderer/tag');
core.wire([renderer]);

const frame = () => new Promise((resolve) => setTimeout(resolve, 30));
const app = dom.window.document.getElementById('app');
const other = dom.window.document.getElementById('other');

const store = core.createStore({ n: 1 });
customElements.define('live-thing', class extends HTMLElement {
  connectedCallback() {
    core.init(this, { mode: 'open' });
    core.render(() => html`<p>${store.n}</p>`);
  }
});

const shown = (element) => element.shadowRoot.textContent.trim();

test('a component shows current state after being removed, updated and re-inserted', async () => {
  const element = dom.window.document.createElement('live-thing');
  app.appendChild(element);
  await frame();
  assert.equal(shown(element), '1', 'the control rendered');

  element.remove();
  await frame();
  store.n = 2;
  await frame();

  app.appendChild(element);
  await frame();
  await frame();
  assert.equal(shown(element), '2', 'it caught up on reconnection rather than showing the old value');
});

test('and after a move between parents with a write in between', async () => {
  const element = dom.window.document.createElement('live-thing');
  app.appendChild(element);
  await frame();

  store.n = 3;
  other.appendChild(element);
  await frame();
  await frame();
  assert.equal(shown(element), '3', 'a move is a disconnect and a connect, and it re-read the store');

  store.n = 4;
  await frame();
  assert.equal(shown(element), '4', 'and it is still subscribed afterwards');
});

/**
 * The optimisation itself, pinned as the other half. A manually-initialised container never enters the
 * tree, so no `connectedCallback` ever runs for it and nothing can catch it up — which is exactly why
 * the skip is only safe for components, and why this asserts the boundary rather than the absence
 * alone.
 */
test('a write to a disconnected element renders nothing, which is what makes the catch-up necessary', async () => {
  const detached = dom.window.document.createElement('div');
  core.init(detached, { mode: 'open' });
  const local = core.createStore({ n: 1 });
  core.render(() => html`<p>${local.n}</p>`);
  await frame();
  assert.equal(shown(detached), '1', 'the first render happens regardless');

  local.n = 2;
  await frame();
  await frame();
  assert.equal(shown(detached), '1', 'the write was skipped while it was out of the tree');
});
