/**
 * Keyed reconciliation, against every mutation a list can undergo, checked two ways.
 *
 * A keyed renderer's whole promise is that the node for a key **is the same node** across a
 * reorder — that is what preserves focus, scroll position, media playback and whatever a
 * third-party library attached. Getting the final order right while rebuilding the nodes looks
 * identical from the outside and destroys all of it.
 *
 * So each step asserts both: the rendered order matches the model exactly, and every key that
 * survived kept its node. The permutations come from a **seeded** generator — `CLAUDE.md` is
 * explicit that unseeded randomness turns a DOM-shape-dependent bug into an intermittent one whose
 * bisections contradict each other.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const key of ['document', 'Node', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];

const { render, keyed } = await load('renderer');
/** List rendering is a module now; this suite drives the renderer directly, so it uses the
 *  no-registry door rather than `wire([domRender, lists])`. */
const { lists } = await load('renderer/lists');
(await load('renderer')).handle(lists.fn);
const html = (strings, ...values) => ({ strings, values });

/** Mulberry32 — small, fast, and the same sequence every run, which is the point. */
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const draw = (rows, container) =>
  render(
    html`<ul>${rows.map((row) => keyed(row, html`<li data-id=${row}>${row}</li>`))}</ul>`,
    container
  );

const idsIn = (container) => [...container.querySelectorAll('li')].map((li) => li.dataset.id);
const nodesIn = (container) =>
  new Map([...container.querySelectorAll('li')].map((li) => [li.dataset.id, li]));

let pass = 0;
const failures = [];

/**
 * One step: render `next`, then check the order and that every surviving key kept its node.
 */
const step = (label, container, before, next) => {
  const nodesBefore = nodesIn(container);
  draw(next, container);

  const order = idsIn(container);
  if (order.join(',') !== next.join(',')) {
    failures.push(`${label}: order is ${order.join(',')}, expected ${next.join(',')}`);
    return;
  }
  const nodesAfter = nodesIn(container);
  for (const key of next) {
    if (!nodesBefore.has(key)) continue;
    if (nodesBefore.get(key) !== nodesAfter.get(key)) {
      failures.push(`${label}: key "${key}" survived the update but its node was rebuilt`);
      return;
    }
  }
  pass++;
  void before;
};

/* ── named mutations ────────────────────────────────────────────────────────────────────────── */
{
  const base = ['a', 'b', 'c', 'd', 'e'];
  const cases = {
    'reverse': [...base].reverse(),
    'swap the ends': ['e', 'b', 'c', 'd', 'a'],
    'swap adjacent': ['b', 'a', 'c', 'd', 'e'],
    'move one to the front': ['d', 'a', 'b', 'c', 'e'],
    'move one to the back': ['a', 'c', 'd', 'e', 'b'],
    'remove from the middle': ['a', 'b', 'd', 'e'],
    'remove the first': ['b', 'c', 'd', 'e'],
    'remove the last': ['a', 'b', 'c', 'd'],
    'insert at the front': ['z', 'a', 'b', 'c', 'd', 'e'],
    'insert in the middle': ['a', 'b', 'z', 'c', 'd', 'e'],
    'insert at the back': ['a', 'b', 'c', 'd', 'e', 'z'],
    'replace everything': ['v', 'w', 'x', 'y', 'z'],
    'empty it': [],
    'refill it': ['a', 'b', 'c'],
    'one item': ['a'],
    'duplicate-free shuffle': ['c', 'e', 'a', 'd', 'b'],
  };
  for (const [label, next] of Object.entries(cases)) {
    const container = dom.window.document.createElement('div');
    draw(base, container);
    step(label, container, base, next);
  }
}

/* ── seeded random permutations, applied in sequence to one container ───────────────────────── */
{
  const random = seeded(20260824);
  const container = dom.window.document.createElement('div');
  let rows = Array.from({ length: 12 }, (_, i) => `k${i}`);
  draw(rows, container);

  for (let round = 0; round < 60; round++) {
    const next = [...rows];
    /** Shuffle, then drop or add a few, so removals and insertions interleave with moves. */
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    const drop = Math.floor(random() * 3);
    for (let i = 0; i < drop && next.length; i++) next.splice(Math.floor(random() * next.length), 1);
    const add = Math.floor(random() * 3);
    for (let i = 0; i < add; i++) next.splice(Math.floor(random() * (next.length + 1)), 0, `n${round}-${i}`);

    step(`round ${round}`, container, rows, next);
    rows = next;
  }
}

/* ── nested keyed lists ─────────────────────────────────────────────────────────────────────── */
{
  const container = dom.window.document.createElement('div');
  const draw2 = (groups) =>
    render(
      html`<div>${groups.map((group) =>
        keyed(
          group.id,
          html`<section data-id=${group.id}>${group.rows.map((row) => keyed(row, html`<li data-id=${row}>${row}</li>`))}</section>`
        )
      )}</div>`,
      container
    );

  draw2([
    { id: 'g1', rows: ['a', 'b'] },
    { id: 'g2', rows: ['c', 'd'] },
  ]);
  const outerBefore = container.querySelector('section[data-id="g1"]');
  const innerBefore = container.querySelector('li[data-id="a"]');

  draw2([
    { id: 'g2', rows: ['d', 'c'] },
    { id: 'g1', rows: ['b', 'a'] },
  ]);

  const outerAfter = container.querySelector('section[data-id="g1"]');
  const innerAfter = container.querySelector('li[data-id="a"]');
  if (outerAfter === outerBefore) pass++;
  else failures.push('a nested keyed group was rebuilt rather than moved');
  if (innerAfter === innerBefore) pass++;
  else failures.push('a row inside a moved group was rebuilt');
  const order = [...container.querySelectorAll('section')].map((s) => s.dataset.id);
  if (order.join(',') === 'g2,g1') pass++;
  else failures.push(`nested groups are in ${order.join(',')}`);
}

if (failures.length) {
  console.log(`\n  ${failures.length} keyed reconciliation failure(s):\n`);
  for (const failure of failures) console.log('    ' + failure);
}
console.log(`keyed reconciliation: ${pass} mutations, order and node identity both held`);
assert.equal(failures.length, 0);
