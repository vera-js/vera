/**
 * **An automatic list settles its unchanged ENDS on raw slots** (2026-10-23): before resolving any key, a list's run
 * matches last run's rows against the array's raw slots from the front and from the back, and walks only the middle,
 * where a row met again at its own position skips the key lookup too. A swap or a splice of 1000 rows used to re-walk
 * every row. These rows pin what that shortcut must never change:
 *
 * - a middle item repeating a KEPT end's key is still a duplicate (the kept rows are stamped as met before the middle);
 * - a write to a slot the run skipped still re-runs the list (the walk keeps its one subscription to the contents);
 * - a changed row function re-runs every row (the shortcut is off then);
 * - an `id` written in place re-keys its row, as a full walk does;
 * - an array-subclass store, whose reads are per-index links, keeps the full walk;
 * - a reassignment with mostly the same items keeps their nodes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { init, html, wire, createStore, flush } = await load('core');
const { renderer } = await load('renderer');
const { lists } = await load('renderer/keyed');
wire([renderer, lists]);
const settle = async () => { flush(); await new Promise((resolve) => setTimeout(resolve, 0)); };
const make = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, t: `${prefix}${i + 1}` }));

/** One list over `state.rows`, its row count and the parent's, and the rendered texts. */
const mount = (state, row = (r) => html`<li>${r.t}</li>`) => {
  const counts = { rows: 0, parents: 0 };
  const host = document.createElement('div');
  document.body.append(host);
  let fn = row;
  init(host, () => () => { counts.parents++; const f = fn; return html`<ul>${state.rows.map((r) => { counts.rows++; return f(r); })}</ul>`; });
  const texts = () => [...host.querySelector('ul').children].map((li) => li.textContent).join();
  const nodes = () => [...host.querySelector('ul').children];
  return { host, counts, texts, nodes, setRow: (next) => { fn = next; } };
};

test('a swap moves the two rows, runs no row and no parent, and keeps every node', async () => {
  const state = createStore({ rows: make('s', 6) });
  const m = mount(state);
  await settle();
  const before = m.nodes();
  m.counts.rows = m.counts.parents = 0;
  const r = state.rows;
  const t = r[1];
  r[1] = r[4];
  r[4] = t;
  await settle();
  assert.equal(m.texts(), 's1,s5,s3,s4,s2,s6');
  assert.deepEqual(m.counts, { rows: 0, parents: 0 }, 'no row re-ran, the parent did not');
  const after = m.nodes();
  assert.ok([0, 2, 3, 5].every((i) => after[i] === before[i]) && after[1] === before[4] && after[4] === before[1], 'nodes moved, none rebuilt');
  m.host.remove();
});

for (const [end, id, expect] of [['FRONT', 1, 'A,DUP,d3'], ['BACK', 3, 'd1,DUP,A']])
test(`a middle item repeating the KEPT ${end} end's key is still a duplicate: distinct rows, the warning once`, async () => {
  const state = createStore({ rows: make('d', 3) });
  const m = mount(state);
  await settle();
  const warns = [];
  const warn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    /** [a, b, c] → [a, b2, c] with b2.id the id of a (or c): the ends a and c are kept, b2 is the middle. */
    state.rows[1] = { id, t: 'dup' };
    await settle();
  } finally {
    console.warn = warn;
  }
  assert.equal(m.texts(), 'd1,dup,d3', 'three rows, each its own');
  const lis = m.nodes();
  assert.equal(new Set(lis).size, 3, 'three distinct nodes');
  /** The LIST's own warning: the part's reconcile says the same code about any keyed list ("a keyed list"). */
  if (!isProduction)
    assert.equal(warns.filter((w) => w.includes('keyed-duplicate-key') && w.includes('an automatic .map list')).length, 1, `the list found the duplicate (${warns})`);
  /** Each row still answers its OWN item: a row met twice would follow only one of them (the DOM above can look right). */
  state.rows[id === 1 ? 0 : 2].t = 'A';
  await settle();
  state.rows[1].t = 'DUP';
  await settle();
  assert.equal(m.texts(), expect, 'each item writes its own row');
  m.host.remove();
});

test('a write to a slot the run skipped still re-runs the list', async () => {
  const state = createStore({ rows: make('w', 6) });
  const m = mount(state);
  await settle();
  const r = state.rows;
  const t = r[2];
  r[2] = r[3];
  r[3] = t;
  await settle();
  assert.equal(m.texts(), 'w1,w2,w4,w3,w5,w6', 'CONTROL: the swap rendered');
  /** Slots 0 and 5 were kept ends in that run, never walked. */
  r[0] = { id: 70, t: 'front' };
  await settle();
  r[5] = { id: 80, t: 'back' };
  await settle();
  assert.equal(m.texts(), 'front,w2,w4,w3,w5,back');
  m.host.remove();
});

/**
 * The parent re-renders over the SAME array (a field it reads), so every raw slot still matches its row: only `all`
 * keeps the shortcut off. (`state.rows = [...state.rows]` would not test it — spreading the proxy stores proxied items,
 * which match no row's raw slot, so nothing is skipped either way.)
 */
test('a changed row function after a swap re-runs every row', async () => {
  const state = createStore({ rows: make('f', 5), n: 0 });
  const host = document.createElement('div');
  document.body.append(host);
  let fn = (x) => html`<li>${x.t}</li>`;
  init(host, () => () => { void state.n; const f = fn; return html`<ul>${state.rows.map((r) => f(r))}</ul>`; });
  await settle();
  const texts = () => [...host.querySelector('ul').children].map((li) => li.textContent).join();
  const r = state.rows;
  const t = r[1];
  r[1] = r[3];
  r[3] = t;
  await settle();
  assert.equal(texts(), 'f1,f4,f3,f2,f5', 'CONTROL: the swap rendered');
  fn = (x) => html`<li>${x.t}!</li>`;
  state.n++;
  await settle();
  assert.equal(texts(), 'f1!,f4!,f3!,f2!,f5!');
  host.remove();
});

test('an id written in place re-keys its row, as a full walk does', async () => {
  const state = createStore({ rows: make('k', 4) });
  const m = mount(state);
  await settle();
  const before = m.nodes();
  state.rows[2].id = 99;
  /** The list hears nothing yet (an id is a field); a swap elsewhere re-runs it. */
  const r = state.rows;
  const t = r[0];
  r[0] = r[1];
  r[1] = t;
  await settle();
  assert.equal(m.texts(), 'k2,k1,k3,k4');
  const after = m.nodes();
  assert.ok(after[2] !== before[2], 'the re-keyed row is a new row (its key changed)');
  assert.ok(after[3] === before[3] && after[0] === before[1] && after[1] === before[0], 'the others kept their nodes');
  m.host.remove();
});

test('an array-SUBCLASS store keeps the full walk: a swap, then a write to an end, re-runs the list', async () => {
  class Rows extends Array {}
  const rows = Rows.from(make('c', 5));
  const state = createStore({ rows });
  const m = mount(state);
  await settle();
  assert.equal(m.texts(), 'c1,c2,c3,c4,c5', 'CONTROL: it rendered');
  const r = state.rows;
  const t = r[1];
  r[1] = r[3];
  r[3] = t;
  await settle();
  assert.equal(m.texts(), 'c1,c4,c3,c2,c5', 'the swap');
  r[0] = { id: 50, t: 'front' };
  await settle();
  r[4] = { id: 60, t: 'back' };
  await settle();
  assert.equal(m.texts(), 'front,c4,c3,c2,back');
  m.host.remove();
});

/**
 * A reassignment re-renders the PARENT, whose `.map` call re-runs every row (its function may close over the parent's
 * new values) — so the shortcut is off for it, and only node identity is the claim here.
 */
test('a reassignment with mostly the same items keeps their nodes (every row re-runs: the parent rendered)', async () => {
  const state = createStore({ rows: make('a', 6) });
  const m = mount(state);
  await settle();
  const before = m.nodes();
  m.counts.rows = 0;
  const raw = [...state.rows];
  state.rows = [raw[0], raw[1], { id: 30, t: 'new' }, raw[3], raw[4], raw[5]];
  await settle();
  assert.equal(m.texts(), 'a1,a2,new,a4,a5,a6');
  const after = m.nodes();
  assert.ok([0, 1, 3, 4, 5].every((i) => after[i] === before[i]), 'the unchanged rows kept their nodes');
  assert.equal(m.counts.rows, 6, 'every row re-ran with the parent');
  m.host.remove();
});

test('a removal and an insertion in the middle, then a clear: the list stays exact', async () => {
  const state = createStore({ rows: make('x', 8) });
  const m = mount(state);
  await settle();
  state.rows.splice(3, 1);
  await settle();
  assert.equal(m.texts(), 'x1,x2,x3,x5,x6,x7,x8');
  state.rows.splice(2, 0, { id: 40, t: 'in' }, { id: 41, t: 'in2' });
  await settle();
  assert.equal(m.texts(), 'x1,x2,in,in2,x3,x5,x6,x7,x8');
  state.rows.push({ id: 42, t: 'end' });
  state.rows.unshift({ id: 43, t: 'start' });
  await settle();
  assert.equal(m.texts(), 'start,x1,x2,in,in2,x3,x5,x6,x7,x8,end');
  state.rows.reverse();
  await settle();
  assert.equal(m.texts(), 'end,x8,x7,x6,x5,x3,in2,in,x2,x1,start');
  state.rows = [];
  await settle();
  assert.equal(m.texts(), '');
  m.host.remove();
});
