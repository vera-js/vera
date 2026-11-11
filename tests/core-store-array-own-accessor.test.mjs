/**
 * **An accessor defined on a store array THROUGH the store runs with the store as `this`** (2026-11-11). The array
 * trap reads a slot off the raw array (`obj[prop]`, its fast path), so a getter defined there ran with the raw array as
 * `this` and its reads were untracked: a render reading `state.list.total` was not woken by `state.list[0] = 5`. The
 * store sees the define, so it wraps the getter there (one function per accessor defined, nothing per read; the read
 * trap is unchanged): the getter is called with the store as `this`. Consequences, documented and pinned: the raw
 * array holds the wrapper (so `Object.getOwnPropertyDescriptor(…).get` is not the author's function, and a read of the
 * raw array outside the store runs the getter with the store as `this`); and a SECOND copy of core over the same raw
 * array reads through the first copy's store. Out of scope: an accessor defined on the raw array BEFORE it is wrapped
 * (D10's ruling). CONTROL: an index read is unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, isProduction } from './dist.mjs';

const { createStore, effect } = await load('core');
const watch = (read, fx = effect) => {
  let runs = 0;
  fx(() => { read(); runs++; }, { owner: {}, timing: 'sync' }).run();
  return () => runs - 1;
};
const total = { get() { return this[0] + this[1]; }, configurable: true, enumerable: false };

test('a getter defined through the store reads through the store: its reader wakes on an index write', () => {
  const s = createStore({ list: [1, 2] });
  Object.defineProperty(s.list, 'total', total);
  const woke = watch(() => s.list.total);
  const index = watch(() => s.list[0]);
  s.list[0] = 5;
  assert.equal(s.list.total, 7);
  assert.equal(index(), 1, 'CONTROL: the index reader woke');
  assert.equal(woke(), 1, 'the getter\'s reader woke');
});

test('the raw array holds the wrapper: read outside the store it gives the same value and does not throw', () => {
  const raw = [1, 2];
  const s = createStore({ list: raw });
  Object.defineProperty(s.list, 'total', total);
  assert.equal(raw.total, 3, 'the same value, read raw');
  assert.notEqual(Object.getOwnPropertyDescriptor(raw, 'total').get, total.get, 'the descriptor holds the wrapper, not the author\'s function');
});

test('LIMIT: a second copy of core over the same raw array reads the getter through the FIRST copy\'s store', async () => {
  const other = await import(`../packages/core/dist/${isProduction ? 'development/vera.js' : 'vera.min.js'}`);
  const raw = [1, 2];
  const first = createStore({ list: raw });
  Object.defineProperty(first.list, 'total', total);
  const second = other.createStore({ list: raw });
  const woke = watch(() => second.list.total, other.effect);
  second.list[0] = 5;
  assert.equal(second.list.total, 7, 'the value is right');
  assert.equal(woke(), 0, 'the second copy\'s reader is not woken (its getter tracked in the first copy)');
});
