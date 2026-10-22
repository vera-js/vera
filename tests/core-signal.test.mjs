/**
 * **`signal` and the `deep` option** (2026-10-22: `ref` and `shallowRef` were renamed `signal`). A signal is SHALLOW by
 * default, as every signals library and TC39's `Signal.State` is: replacing `.value` notifies, mutating inside it does
 * not; `{ deep: true }` tracks the contents too (what `ref` did). `createStore(obj, { deep: false })` tracks only its
 * top-level keys. `deep` takes effect only as the boolean opposite of the default — in BOTH builds — and development
 * names any other value. Counts are exact, each against its control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProduction, load } from './dist.mjs';

const { signal, createStore, createHook } = await load('core');
/** A raw hook reading `read`, counting its runs after the first. */
const watch = (read) => {
  let runs = 0;
  const run = createHook({ element: {}, priority: 10, callback: () => { read(); runs++; } });
  run(undefined, true);
  return () => runs - 1;
};

test('a signal is shallow: replacing .value notifies, mutating inside it does not', () => {
  const s = signal({ x: 1 });
  const runs = watch(() => s.value.x);
  s.value.x = 2;
  assert.equal(runs(), 0, 'a mutation inside notifies nothing');
  s.value = { x: 3 };
  assert.equal(runs(), 1, 'CONTROL: replacing it does');
});

test('{ deep: true } tracks the contents too — the same mutation notifies', () => {
  const s = signal({ x: 1 }, { deep: true });
  const runs = watch(() => s.value.x);
  s.value.x = 2;
  assert.equal(runs(), 1);
  assert.equal(s.value.x, 2);
});

test('an empty signal holds undefined, and is an element ref by shape', () => {
  const s = signal();
  assert.equal(s.value, undefined);
  assert.ok('value' in s);
});

test('createStore(obj, { deep: false }) tracks its top-level keys only', () => {
  const store = createStore({ o: { x: 1 }, k: 1 }, { deep: false });
  const runs = watch(() => { void store.k; void store.o.x; });
  store.o.x = 2;
  assert.equal(runs(), 0, 'a nested mutation notifies nothing');
  store.k = 2;
  assert.equal(runs(), 1, 'CONTROL: a top-level write does');
  const deep = createStore({ o: { x: 1 } });
  const deepRuns = watch(() => deep.o.x);
  deep.o.x = 2;
  assert.equal(deepRuns(), 1, 'CONTROL: without the option the same mutation notifies');
});

test('a non-boolean deep is the DEFAULT in both builds; development names it once per call', () => {
  const warns = [];
  const warn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const s = signal({ x: 1 }, { deep: 'yes' });
    const runs = watch(() => s.value.x);
    s.value.x = 2;
    assert.equal(runs(), 0, "deep: 'yes' is not deep — the default (shallow)");
    const store = createStore({ o: { x: 1 } }, { deep: 0 });
    const storeRuns = watch(() => store.o.x);
    store.o.x = 2;
    assert.equal(storeRuns(), 1, 'deep: 0 is not false — the default (deep)');
  } finally {
    console.warn = warn;
  }
  const named = warns.filter((w) => w.includes('deep-not-boolean'));
  assert.equal(named.length, isProduction ? 0 : 2, isProduction ? 'production: silent' : 'development: one warning per call');
});
