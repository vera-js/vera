/**
 * **A computed written into a store comes back as itself** (2026-11-11), never wrapped, as a
 * signal does: its tag is `[object Computed]`, a type nothing claims. A read through the store still subscribes, through
 * the computed itself. CONTROL: a plain object written into a store comes back as a store.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, computed, effect } = await load('core');
const watch = (read) => {
  let runs = 0;
  effect(() => { read(); runs++; }, { owner: {}, timing: 'sync' }).run();
  return () => runs - 1;
};

test('a computed in a store is the computed itself, and reading it through the store subscribes', () => {
  const source = createStore({ n: 1 });
  const c = computed(() => source.n * 2);
  const store = createStore({ c: null });
  store.c = c;
  assert.equal(store.c, c, 'never wrapped');
  assert.equal(Object.prototype.toString.call(c), '[object Computed]');
  const runs = watch(() => store.c.value);
  source.n = 2;
  assert.equal(store.c.value, 4);
  assert.equal(runs(), 1);
});

test('CONTROL: a plain object written into a store comes back as a store', () => {
  const store = createStore({ o: null });
  const raw = { x: 1 };
  store.o = raw;
  assert.notEqual(store.o, raw);
});
