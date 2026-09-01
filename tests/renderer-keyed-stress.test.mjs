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
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const key of ['document', 'Node', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];

const { renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const html = (strings, ...values) => ({ strings, values });

/** Mulberry32 — small, fast, and the same sequence every run, which is the point. */
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const draw = (rows, container) =>
  renderInto(
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
    renderInto(
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

/**
 * **A repeated key used to crash the render**, and then — once the crash was fixed — to lose a row.
 *
 * `keyed` documents duplicate keys as undefined behaviour, and they stay that way: which of two
 * items keeps the existing node is not specified. Undefined has to mean *a list*, though, and it
 * meant neither of these:
 *
 * 1. `TypeError: Cannot read properties of null (reading '_element')`, three frames inside a private
 *    algorithm, naming nothing the caller wrote. The key→index map holds one index per key, so the
 *    second occurrence of a key found the slot the first had already consumed and nulled.
 * 2. With that fixed, a row silently **disappeared**. The map is built once, and the head/tail
 *    branches consume items by moving the pointers without nulling anything — so an index that was
 *    live when the map was built can now be outside the window, and a repeated key handed the same
 *    item to two positions. The render then produced one row fewer than the list held. That is the
 *    worse of the two: nothing throws and the page is simply wrong.
 *
 * Neither is reachable with unique keys, which is why the suite above never saw them. They need a
 * duplicate **and** a reorder **and** a new key in the same step, and were found by fuzzing over a
 * four-key alphabet so that duplicates were constant rather than occasional.
 */
{
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  /** Key and label differ here, so a dropped row is visible — above they are the same string. */
  const paint = (rows) =>
    renderInto(
      html`<ul>${rows.map(([key, label]) => keyed(key, html`<li data-id=${key}>${label}</li>`))}</ul>`,
      container
    );
  const labels = () => [...container.querySelectorAll('li')].map((li) => li.textContent).join('|');

  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    /** The shrunk transition from the fuzz: a duplicate, a reorder and a new key at once. */
    const before = [['a', '1'], ['b', '2'], ['c', '3']];
    const after = [['b', '2'], ['b', '4'], ['a', '1'], ['c', '3'], ['d', '5']];
    paint(before);
    const startingLabels = labels();
    paint(after);
    if (startingLabels === '1|2|3') pass++;
    else failures.push(`the setup for duplicate keys rendered ${startingLabels}`);
    if (labels() === '2|4|1|3|5') pass++;
    else failures.push(`a duplicate key rendered ${labels()} instead of 2|4|1|3|5`);

    /**
     * The second failure needs its own case: fixing only the null check left this rendering
     * `a0|a2|a3|a4` for a five-row list, and every case above still passed. Found by searching small
     * lists over a three-key alphabet against the half-fixed build, then shrunk.
     */
    paint([['b', 'b0'], ['a', 'b2']]);
    paint([['c', 'a0'], ['b', 'a1'], ['b', 'a2'], ['a', 'a3'], ['c', 'a4']]);
    if (labels() === 'a0|a1|a2|a3|a4') pass++;
    else failures.push(`a repeated key dropped a row: rendered ${labels()} of five`);

    /** And the general case: every row the list holds is rendered, whatever the keys repeat. */
    const rounds = [
      [['a', '1'], ['a', '2']],
      [['a', '2'], ['a', '1'], ['b', '3']],
      [['b', '3'], ['a', '1'], ['a', '2'], ['a', '9']],
      [['a', '9'], ['b', '3']],
      [['c', '7'], ['c', '8'], ['c', '9'], ['a', '1']],
      [['a', '1'], ['c', '9'], ['c', '8'], ['c', '7'], ['d', '0']],
    ];
    for (const rows of rounds) {
      paint(rows);
      const want = rows.map(([, label]) => label).join('|');
      if (labels() === want) pass++;
      else failures.push(`duplicate keys rendered ${labels()} where the list held ${want}`);
    }
  } finally {
    console.warn = warn;
  }

  /** Undefined behaviour is worth saying out loud, since it behaves correctly most of the time. */
  if (!isProduction) {
    if (said.some((line) => /^\[vera\] keyed: the key /.test(line))) pass++;
    else failures.push('a duplicate key produced no warning in development');
  }
}

if (failures.length) {
  console.log(`\n  ${failures.length} keyed reconciliation failure(s):\n`);
  for (const failure of failures) console.log('    ' + failure);
}
console.log(`keyed reconciliation: ${pass} mutations, order and node identity both held`);
assert.equal(failures.length, 0);
