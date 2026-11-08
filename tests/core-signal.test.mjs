/**
 * **`signal` and the `deep` option** (2026-10-22: `ref` and `shallowRef` were renamed `signal`). A signal is SHALLOW by
 * default, as every signals library and TC39's `Signal.State` is: replacing `.value` notifies, mutating inside it does
 * not; `{ deep: true }` tracks the contents too (what `ref` did). `deep` takes effect only as `true`, in BOTH builds,
 * and development names any other value. A signal is a value CELL (no Proxy): it keeps the shape a `{ value }` object
 * shows (own enumerable `value`: keys, JSON, spread, `in`), its tag keeps a store from wrapping it, and its writes compare
 * with `!==`. Counts are exact, each against its control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProduction, load } from './dist.mjs';

const { signal, createStore } = await load('core');
/** The raw hook primitive is core-internal since `effect` (2026-10-22): reached through core's own hand-off, `$s[2]`. */
const createHook = (await load('core')).inserts.$s[2];
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

test("a signal's value lives on its shared prototype: JSON writes the value, keys and a spread see nothing, `in` sees it", () => {
  const s = signal(3);
  assert.equal(JSON.stringify(s), '3', 'toJSON is the held value');
  assert.equal(JSON.stringify({ count: signal(4) }), '{"count":4}');
  assert.deepEqual(Object.keys(s), [], 'nothing own: the value is not a key');
  const copy = { ...s };
  assert.deepEqual(Object.keys(copy), [], 'a spread copies no `value`');
  assert.equal(Object.getOwnPropertySymbols(copy).length, 1, "only core's private value symbol rides along, unreadable without core");
  assert.ok('value' in s, 'inherited, so `in` still answers true');
  const listed = [];
  for (const key in s) listed.push(key);
  assert.deepEqual(listed, [], 'for…in lists nothing: the shared members are non-enumerable, as a class prototype\'s are');
  assert.equal(Object.getOwnPropertyDescriptor(s, 'value'), undefined);
  assert.deepEqual(structuredClone(s), {}, 'a deep copy copies own data only');
  assert.equal(Object.prototype.toString.call(s), '[object Signal]');
  assert.equal(Object.getPrototypeOf(s), Object.getPrototypeOf(signal(0)), 'one prototype shared by every signal');
});

test("`in`, keys and for-in on a signal subscribe to nothing (no traps): only reading `.value` does", () => {
  const s = signal(1);
  const inRuns = watch(() => 'value' in s);
  const keyRuns = watch(() => Object.keys(s));
  const valueRuns = watch(() => s.value);
  s.value = 2;
  assert.deepEqual([inRuns(), keyRuns(), valueRuns()], [0, 0, 1], 'CONTROL: the value reader re-ran');
});

test('a write notifies when the new value is !== the held one: not the same value, not -0 over 0, but NaN over NaN', () => {
  const same = signal(1);
  const sameRuns = watch(() => same.value);
  same.value = 1;
  const zero = signal(0);
  const zeroRuns = watch(() => zero.value);
  zero.value = -0;
  const nan = signal(NaN);
  const nanRuns = watch(() => nan.value);
  nan.value = NaN;
  same.value = 2;
  assert.deepEqual([sameRuns(), zeroRuns(), nanRuns()], [1, 0, 1], 'CONTROL included: a different value notifies');
  assert.ok(Object.is(zero.value, 0), '-0 over 0 is no write: the held 0 stays (as a store keeps it), never changed silently');
});

test('what a signal holds comes back as written, and mutating inside it notifies nothing', () => {
  const o = { x: 1 };
  const s = signal(o);
  const runs = watch(() => s.value.x);
  s.value.x = 2;
  assert.equal(s.value, o);
  assert.equal(runs(), 0);
  s.value = { x: 3 };
  assert.equal(runs(), 1, 'CONTROL: replacing it does');
});

test('a signal written into a store comes back as itself, and a read through the store still subscribes', () => {
  const store = createStore({ sig: null, k: 1 });
  const s = signal(1);
  store.sig = s;
  assert.equal(store.sig, s, 'never wrapped');
  const runs = watch(() => store.sig.value);
  s.value = 2;
  assert.equal(runs(), 1);
  const both = watch(() => { void store.k; void s.value; });
  s.value = 3;
  store.k = 2;
  assert.equal(both(), 2, 'one effect hears a store and a signal');
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
  } finally {
    console.warn = warn;
  }
  const named = warns.filter((w) => w.includes('deep-not-boolean'));
  assert.equal(named.length, isProduction ? 0 : 1, isProduction ? 'production: silent' : 'development: one warning per call');
});
