/**
 * **A root render owns its range, never its container.** `renderInto(result, container)` brackets what it renders
 * between two markers, so content before AND after that range survives every re-render — a template swap included.
 *
 * The root part used to run to the end of its container. A node other code appended after the first render (a
 * script's, a browser extension's in `document.body`) then sat inside the render's range, and the next template swap
 * cleared it with the render's own content. The clear's fast path (one `textContent = ''`) must still fire when
 * nothing foreign is there, and hydration bounds its root the same way.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { html } = await load('core');
const { renderInto } = await load('renderer');
const { renderInto: hydrateInto } = await load('renderer/hydrate');

/** Two different templates from ONE function — two call sites, so switching between them is a template swap. */
const swap = (which, label = 'x') => (which ? html`<p>${label}</p>` : html`<b>${label}</b>`);
const foreign = () => Object.assign(document.createElement('aside'), { id: 'foreign' });
const quietly = (work) => {
  const { warn } = console;
  console.warn = () => {};
  try {
    return work();
  } finally {
    console.warn = warn;
  }
};

test('a node appended after the first render survives a template swap', () => {
  const host = document.body.appendChild(document.createElement('div'));
  renderInto(swap(true), host);
  const extra = host.appendChild(foreign());
  renderInto(swap(false), host);
  assert.equal(extra.parentNode, host, 'the appended node is still there');
  assert.equal(host.querySelector('b')?.textContent, 'x', 'the swap rendered');
  assert.equal(host.querySelector('p'), null, 'the old template is gone');
  renderInto(null, host);
  assert.equal(extra.parentNode, host, 'clearing the render keeps it too');
  assert.equal(host.querySelector('b'), null);
});

test('content already in the container before the first render survives too', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const before = host.appendChild(foreign());
  renderInto(swap(true), host);
  renderInto(swap(false), host);
  renderInto(null, host);
  assert.equal(before.parentNode, host);
  assert.equal(host.firstChild, before, 'and it stays first');
});

test('the clear fast path still fires when nothing foreign is present, and only then', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => html`<li>${i}</li>`);
  const draw = (which) => renderInto(which ? html`<ul>${rows(100)}</ul>${rows(100)}` : html`<b>empty</b>`, host);
  const removals = (work) => {
    const records = [];
    const observer = new dom.window.MutationObserver((list) => records.push(...list));
    observer.observe(host, { childList: true });
    work();
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records.filter((r) => r.removedNodes.length > 0).length;
  };
  const host = document.createElement('div');
  draw(true);
  assert.equal(removals(() => draw(false)), 1, 'alone in its container, the swap is ONE removal (textContent)');
  draw(true);
  host.appendChild(foreign());
  assert.ok(removals(() => draw(false)) > 1, 'with a foreign node after it, nodes are removed one by one');
  assert.ok(host.querySelector('#foreign'), 'and the foreign node survives');
});

test('a root list grows in order, inside its range', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const list = (n) => renderInto(Array.from({ length: n }, (_, i) => html`<i>${i}</i>`), host);
  list(2);
  const extra = host.appendChild(foreign());
  list(5);
  assert.deepEqual([...host.querySelectorAll('i')].map((i) => i.textContent), ['0', '1', '2', '3', '4']);
  assert.equal(host.lastChild, extra, 'new items land before the foreign node, never after it');
});

test('hydration bounds its root: a foreign node appended after adoption survives a swap', () => {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = '<p>x</p>';
  const adopted = host.querySelector('p');
  hydrateInto(swap(true), host);
  assert.equal(host.querySelector('p'), adopted, 'adopted, not rebuilt');
  const extra = host.appendChild(foreign());
  assert.equal(extra.previousSibling?.nodeType, 8, 'the end marker sits right after the adopted content');
  hydrateInto(swap(false), host);
  assert.equal(extra.parentNode, host);
  assert.equal(host.querySelector('b')?.textContent, 'x');
});

test('hydration: a top-level list longer on the client than the server rendered does not throw', () => {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = '<i>0</i><i>1</i>';
  /** A template whose top level is the list — a bare array at the root is never adopted, only rendered. */
  const items = (n) => html`${Array.from({ length: n }, (_, i) => html`<i>${i}</i>`)}`;
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    hydrateInto(items(3), host);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual([...host.querySelectorAll('i')].map((i) => i.textContent), ['0', '1', '2']);
  assert.ok(said.length <= 1, 'at most the one fallback warning');
  const extra = host.appendChild(foreign());
  hydrateInto(items(1), host);
  assert.deepEqual([...host.querySelectorAll('i')].map((i) => i.textContent), ['0']);
  assert.equal(host.lastChild, extra);
});

test('hydration: a client-only node at the root lands inside the range', () => {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = '<p>x</p>';
  const node = document.createElement('em');
  const draw = (which) => hydrateInto(which ? html`<p>x</p>${node}` : swap(false), host);
  quietly(() => draw(true));
  assert.equal(node.parentNode, host, 'the node was put in');
  const extra = host.appendChild(foreign());
  draw(false);
  assert.equal(node.parentNode, null, 'it belonged to the render, so the swap removed it');
  assert.equal(extra.parentNode, host, 'the foreign node did not');
});
