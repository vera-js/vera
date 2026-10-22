/**
 * **`resource(source)`** (2026-10-22, `@verajs/store/resource`): async data as a reactive cell, with its races inside it.
 * Rows: the states (first load, refetch, error after a value), latest wins with the older request aborted, an abort is
 * not an error, a sync throw and a plain return, removal aborts and drops a late result, a read after the first `await`
 * is untracked (with its control), it is not a thenable, it throws by code outside a setup, and a server turn makes NO
 * source call. Counts are exact, each with a control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, flush, inserts } = await load('core');
const { renderer } = await load('renderer');
const { resource } = await load('store/resource');
wire([renderer]);
const settle = async (ms = 0) => { flush(); await new Promise((resolve) => setTimeout(resolve, ms)); flush(); };
let seq = 0;
/** A deferred: a promise the row resolves or rejects by hand. */
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
/** Mounts a component holding one resource; returns the cell and the element. */
const mount = async (source) => {
  const tag = `x-res-${++seq}`;
  let cell;
  define(tag, () => { cell = resource(source); return () => html`<p>${cell.loading ? 'loading' : cell.error ? 'error' : String(cell.value)}</p>`; });
  const el = document.createElement(tag);
  document.body.append(el);
  await settle();
  return { cell, el };
};
const snap = (cell) => ({ loading: cell.loading, refreshing: cell.refreshing, value: cell.value, error: cell.error });

test('states: first load, then the value; a refetch keeps the value with refreshing; an error after a value keeps it', async () => {
  const state = createStore({ id: 1 });
  const pending = [];
  const { cell, el } = await mount(() => { const d = deferred(); pending.push([state.id, d]); return d.promise; });
  assert.deepEqual(snap(cell), { loading: true, refreshing: false, value: undefined, error: undefined }, 'first load');
  assert.equal(el.textContent, 'loading');
  pending[0][1].resolve('u1');
  await settle();
  assert.deepEqual(snap(cell), { loading: false, refreshing: false, value: 'u1', error: undefined });
  state.id = 2;
  await settle();
  assert.deepEqual(snap(cell), { loading: false, refreshing: true, value: 'u1', error: undefined }, 'a refetch keeps the value');
  const boom = new Error('boom');
  pending[1][1].reject(boom);
  await settle();
  assert.deepEqual(snap(cell), { loading: false, refreshing: false, value: 'u1', error: boom }, 'stale-while-error');
  el.remove();
});

test('latest wins: two requests settled out of order write only the newer, and the older one\'s signal fired once', async () => {
  const state = createStore({ id: 1 });
  const calls = [];
  const { cell, el } = await mount((signal) => {
    const id = state.id;
    const d = deferred();
    let aborted = 0;
    signal.addEventListener('abort', () => aborted++);
    calls.push({ id, d, aborts: () => aborted });
    return d.promise;
  });
  state.id = 2;
  await settle();
  assert.equal(calls.length, 2, 'CONTROL: the change refetched');
  calls[1].d.resolve('new');
  calls[0].d.resolve('old');
  await settle();
  assert.equal(cell.value, 'new', 'the older answer, arriving last, did not overwrite');
  assert.equal(calls[0].aborts(), 1, "the older request's signal fired exactly once");
  assert.equal(calls[1].aborts(), 0);
  el.remove();
});

test('an abort is not an error: the aborted request rejecting leaves error undefined, and the new value lands', async () => {
  const state = createStore({ id: 1 });
  const { cell, el } = await mount((signal) => {
    const id = state.id;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      setTimeout(() => resolve(`u${id}`), id === 1 ? 50 : 5);
    });
  });
  state.id = 2;
  await settle(30);
  assert.equal(cell.error, undefined);
  assert.equal(cell.value, 'u2');
  el.remove();
});

test('a source that throws synchronously is an error; one that returns a plain value settles at once', async () => {
  const boom = new Error('sync');
  const thrown = await mount(() => { throw boom; });
  assert.deepEqual(snap(thrown.cell), { loading: false, refreshing: false, value: undefined, error: boom });
  assert.equal(thrown.el.textContent, 'error');
  const plain = await mount(() => 42);
  assert.deepEqual(snap(plain.cell), { loading: false, refreshing: false, value: 42, error: undefined });
  assert.equal(plain.el.textContent, '42');
  thrown.el.remove();
  plain.el.remove();
});

test('removal aborts the request in flight and drops a late result', async () => {
  const d = deferred();
  let aborted = 0;
  const { cell, el } = await mount((signal) => { signal.addEventListener('abort', () => aborted++); return d.promise; });
  el.remove();
  await settle();
  assert.equal(aborted, 1, 'the removal aborted it');
  d.resolve('late');
  await settle();
  assert.equal(cell.value, undefined, 'the late result was dropped');
  assert.equal(cell.loading, true);
});

test('a read after the first await is untracked (no refetch); the same read before it refetches — the control', async () => {
  const before = createStore({ n: 1 });
  const after = createStore({ n: 1 });
  let calls = 0;
  const { el } = await mount(async () => { calls++; void before.n; await null; void after.n; return 'x'; });
  await settle();
  assert.equal(calls, 1, 'CONTROL: one call');
  after.n = 2;
  await settle();
  assert.equal(calls, 1, 'a read after the await did not refetch');
  before.n = 2;
  await settle();
  assert.equal(calls, 2, 'a read before the await did');
  el.remove();
});

test('not a thenable: an async setup can hold it without being joined to it', async () => {
  const { cell, el } = await mount(() => new Promise(() => {}));
  assert.equal('then' in cell, false);
  el.remove();
});

test('outside a setup it throws by code, as any hook does (a render included)', async () => {
  assert.throws(() => resource(() => 1), /no-owner|hook/);
  const tag = `x-res-${++seq}`;
  let thrown;
  define(tag, () => () => { try { resource(() => 1); } catch (error) { thrown = error; } return html`<i></i>`; });
  const el = document.createElement(tag);
  document.body.append(el);
  await settle();
  assert.ok(thrown instanceof Error, 'created inside a RENDER, it threw');
  el.remove();
});

test('a server turn makes NO source call, and the cell stays loading', async () => {
  let calls = 0;
  inserts.$ss(1);
  let cell;
  try {
    const tag = `x-res-${++seq}`;
    define(tag, () => { cell = resource(() => { calls++; return 1; }); return () => html`<p>${cell.loading ? 'loading' : 'v'}</p>`; });
    const el = document.createElement(tag);
    document.body.append(el);
    await settle();
    assert.equal(calls, 0, 'no source call inside a server turn');
    assert.equal(cell.loading, true);
    el.remove();
  } finally {
    inserts.$ss(-1);
  }
  const control = await mount(() => { calls++; return 1; });
  assert.equal(calls, 1, 'CONTROL: outside a turn the same source is called');
  control.el.remove();
});
