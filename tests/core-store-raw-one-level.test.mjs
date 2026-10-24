/**
 * **A store keeps what is written into it RAW, one level deep** (2026-10-23): `state.rows = state.rows.filter(…)` hands
 * back an array of the proxies the reads produced, and it was stored as it was — every later list walk met a proxy in
 * every slot (swaps +47–56%, measured). Now a write, and a whole-array method's inserted values, store a proxy as its raw
 * object, and a plain array or object holding proxies one level down as a raw COPY. These rows pin:
 *
 * - the common idioms (`filter`, `slice`, a copy then `sort`, a row replaced by a spread) leave no proxy in raw data;
 * - the user's own array is never rewritten (a copy is stored only when it held proxies; otherwise it is aliased);
 * - identity and reactivity survive: a row read after the unwrap is the SAME proxy as before, and still reactive;
 * - one level only, and plain containers only (a class instance is stored as it is).
 *
 * Raw slots are read through core's `$wr` (a plain store array's raw slots, read without subscribing).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { init, html, wire, createStore, flush, inserts } = await load('core');
const { renderer } = await load('renderer');
const { lists } = await load('renderer/keyed');
wire([renderer, lists]);
const settle = async () => { flush(); await new Promise((resolve) => setTimeout(resolve, 0)); };
const rawOf = inserts.$wr;
const make = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, t: `r${i + 1}`, done: i % 2 === 0, user: { name: `u${i + 1}` } }));
/** How many raw slots of a store array hold the very proxies its reads hand out. */
const proxiesIn = (array) => {
  const raw = rawOf(array);
  let n = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] === array[i]) n++;
  return n;
};

test('CONTROL: the instrument sees proxies in raw slots (a raw slot written by hand)', () => {
  assert.equal(typeof rawOf, 'function', 'core hands its raw read');
  const state = createStore({ rows: make(3) });
  rawOf(state.rows)[0] = state.rows[0];
  assert.equal(proxiesIn(state.rows), 1, 'a proxy planted in raw is counted');
});

test('filter, slice and a copy then sort, reassigned, leave no proxy in raw data', () => {
  for (const [name, write] of [
    ['filter', (s) => { s.rows = s.rows.filter((r) => !r.done); }],
    ['slice', (s) => { s.rows = s.rows.slice(1); }],
    ['copy + sort', (s) => { s.rows = [...s.rows].sort((a, b) => b.id - a.id); }],
    ['concat', (s) => { s.rows = s.rows.concat([{ id: 99, t: 'x' }]); }],
  ]) {
    const state = createStore({ rows: make(6) });
    write(state);
    assert.ok(state.rows.length > 0, `CONTROL (${name}): rows remain`);
    assert.equal(proxiesIn(state.rows), 0, `${name}: no raw slot holds a proxy`);
  }
});

test('a row replaced by a spread, and a pushed spread, store their nested objects raw', () => {
  const state = createStore({ rows: make(3) });
  state.rows[0] = { ...state.rows[0], t: 'replaced' };
  state.rows.push({ ...state.rows[1], id: 50 });
  const raw = rawOf(state.rows);
  assert.equal(raw[0].t, 'replaced', 'CONTROL: the replacement is stored');
  assert.ok(raw[0].user !== state.rows[0].user, 'the replaced row\'s nested object is raw, not the proxy a read hands out');
  assert.ok(raw[3].user !== state.rows[3].user, 'the pushed row\'s nested object is raw');
  assert.equal(state.rows[0].user.name, 'u1', 'and reads the same through the store');
});

test('the user\'s own array is never rewritten: a copy only when it held proxies, aliased otherwise', () => {
  const state = createStore({ rows: make(4) });
  const kept = state.rows.filter(() => true);
  const first = kept[0];
  state.rows = kept;
  assert.equal(kept[0], first, 'the user\'s array still holds what it held (the proxy)');
  assert.equal(proxiesIn(state.rows), 0, 'the store holds raw');
  /** A plain array of plain objects is stored as it is: the store and the user's array are one array. */
  const plain = [{ id: 1 }, { id: 2 }];
  state.rows = plain;
  state.rows.push({ id: 3 });
  assert.equal(plain.length, 3, 'a proxy-free array is aliased, as before');
});

test('identity and reactivity survive the unwrap: the same proxy before and after, and its writes still render', async () => {
  const state = createStore({ rows: make(5) });
  const host = document.createElement('div');
  document.body.append(host);
  init(host, () => () => html`<ul>${state.rows.map((r) => html`<li>${r.t}</li>`)}</ul>`);
  await settle();
  const third = state.rows[2];
  state.rows = state.rows.filter((r) => r.id !== 2);
  await settle();
  assert.equal(state.rows.indexOf(third), 1, 'the row read before is found again (one proxy per raw object)');
  state.rows.splice(state.rows.indexOf(third), 1);
  await settle();
  assert.equal([...host.querySelectorAll('li')].map((li) => li.textContent).join(), 'r1,r4,r5', 'the remove idiom removes the right row');
  state.rows[0].t = 'R1';
  await settle();
  assert.equal(host.querySelector('li').textContent, 'R1', 'a write through a row read after the unwrap renders');
  host.remove();
});

test('a SHALLOW store (a signal) keeps what it is given: store rows put in a signal stay store rows', async () => {
  const { signal } = await load('core');
  const state = createStore({ rows: make(4) });
  const picked = signal([]);
  picked.value = state.rows.filter((r) => r.done);
  assert.equal(picked.value[0], state.rows[0], 'the signal hands back the store row it was given (the proxy)');
  const host = document.createElement('div');
  document.body.append(host);
  init(host, () => () => html`<p>${picked.value.map((r) => r.t).join(',')}</p>`);
  await settle();
  picked.value[0].t = 'R1';
  await settle();
  assert.equal(host.textContent, 'R1,r3', 'a write through the signal\'s row still reaches the store and renders');
  host.remove();
});

test('one level, plain containers only: deeper proxies and class instances are stored as they are', () => {
  const state = createStore({ rows: make(2), other: [{ deep: { x: 1 } }] });
  const deep = { inner: { held: state.rows[0] } };
  state.box = deep;
  assert.equal(deep.inner.held, state.rows[0], 'the user\'s object is untouched');
  class Holder { constructor(v) { this.v = v; } }
  const holder = new Holder(state.rows[1]);
  state.holder = holder;
  assert.equal(holder.v, state.rows[1], 'a class instance is not copied or rewritten');
});
