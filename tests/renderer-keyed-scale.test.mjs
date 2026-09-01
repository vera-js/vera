/**
 * Keyed reconciliation at a size that forces the slow path, asserted for **correctness** rather than
 * speed.
 *
 * `renderer-keyed-stress.test.mjs` runs sixty seeded rounds over twelve rows, which is the right
 * shape for finding logic errors and the wrong size for finding the ones that only appear once the
 * head/tail scan gives up and the key maps are built. `bench/renderer-vs-lit.mjs` renders a thousand
 * rows and never checks that the result is right — it is a stopwatch, not an oracle.
 *
 * A full reverse is the case worth the most: head matching fails on the first row, tail matching
 * fails on the last, and every item has to be found through `newKeyToIndex`/`oldKeyToIndex`. Getting
 * the order right while quietly rebuilding the nodes looks identical from the outside and destroys
 * focus, scroll position and anything a third party attached — so node identity is asserted too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];

const { renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { html } = await load('core');

const host = () => dom.window.document.createElement('div');
const draw = (ids, into) =>
  renderInto(html`<ul>${ids.map((id) => keyed(id, html`<li data-id=${id}>${id}</li>`))}</ul>`, into);
const idsIn = (into) => [...into.querySelectorAll('li')].map((node) => node.dataset.id);

test('a full reverse of 1 000 rows keeps the order and reuses every node', () => {
  const into = host();
  const ids = Array.from({ length: 1000 }, (_, i) => `k${i}`);
  draw(ids, into);
  assert.equal(idsIn(into).length, 1000);

  const before = new Map([...into.querySelectorAll('li')].map((node) => [node.dataset.id, node]));
  const reversed = [...ids].reverse();
  draw(reversed, into);

  assert.deepEqual(idsIn(into), reversed, 'the order is wrong after a full reverse');
  const rebuilt = [...into.querySelectorAll('li')].filter((node) => before.get(node.dataset.id) !== node);
  assert.equal(rebuilt.length, 0,
    `${rebuilt.length} rows were rebuilt rather than moved — correct order, destroyed focus and scroll`);
});

test('removing 800 rows from the middle leaves exactly the survivors, in order', () => {
  const into = host();
  const ids = Array.from({ length: 1000 }, (_, i) => `r${i}`);
  draw(ids, into);
  const next = [...ids.slice(0, 100), ...ids.slice(900)];
  draw(next, into);
  assert.deepEqual(idsIn(into), next);
});

test('interleaving a new row between every existing one', () => {
  const into = host();
  const ids = Array.from({ length: 400 }, (_, i) => `a${i}`);
  draw(ids, into);
  const next = ids.flatMap((id, i) => [id, `n${i}`]);
  draw(next, into);
  assert.deepEqual(idsIn(into), next);
});

test('deep nesting builds and reaches the leaf', () => {
  const into = host();
  const deep = (n) => (n === 0 ? html`<i>leaf</i>` : html`<div>${deep(n - 1)}</div>`);
  renderInto(deep(400), into);
  let depth = 0;
  let node = into.querySelector('div');
  while (node) {
    depth++;
    node = node.querySelector('div');
  }
  assert.equal(depth, 400, 'the tree is not as deep as it was asked to be');
  assert.ok(into.querySelector('i'), 'the leaf never rendered');
});
