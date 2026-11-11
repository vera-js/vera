/**
 * **A store decides "is this a change" by `Object.is`**, as a signal and a computed do (one rule): `-0` written over `0`
 * is stored and notified, `NaN` over `NaN` is no change, every other value as `===`. Through every door a write has: `=`,
 * `Object.defineProperty`, an array index (and its walkers' `ITEMS` channel). CONTROL: a different value notifies, the
 * same value does not.
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

test('-0 over 0 is stored and notified; NaN over NaN is no change (a record key)', () => {
  const raw = { z: 0, n: NaN, same: 1 };
  const s = createStore(raw);
  const runs = [watch(() => s.z), watch(() => s.n), watch(() => s.same)];
  s.z = -0;
  s.n = NaN;
  s.same = 1;
  assert.ok(Object.is(raw.z, -0), '-0 is stored');
  assert.deepEqual(runs.map((r) => r()), [1, 0, 0]);
  s.same = 2;
  assert.equal(runs[2](), 1, 'CONTROL: a different value notifies');
});

test('the same rule through defineProperty and an array index (its walkers included)', () => {
  const s = createStore({ z: 0, list: [0, NaN] });
  const defined = watch(() => s.z);
  Object.defineProperty(s, 'z', { value: -0, writable: true, enumerable: true, configurable: true });
  assert.equal(defined(), 1, 'defineProperty with -0 over 0 notifies');
  const list = s.list;
  const at0 = watch(() => list[0]);
  const walk = watch(() => list.map((x) => x));
  list[1] = NaN;
  assert.deepEqual([at0(), walk()], [0, 0], 'NaN over NaN at an index wakes neither the index nor the walkers');
  list[0] = -0;
  assert.ok(Object.is(list[0], -0));
  assert.deepEqual([at0(), walk()], [1, 1], '-0 over 0 at an index wakes both');
});

test('a computed recomputing -0 from 0 notifies; NaN from NaN does not', () => {
  const s = createStore({ v: 0, w: NaN });
  const neg = computed(() => -s.v);
  const nan = computed(() => s.w * 2);
  const negRuns = watch(() => neg.value);
  const nanRuns = watch(() => nan.value);
  s.v = -0; // the computed goes from -0 (−0) to 0 (−(−0))
  s.w = NaN;
  s.w = 7;
  assert.ok(Object.is(neg.value, 0));
  assert.equal(nanRuns(), 1, 'NaN → NaN was no change; NaN → 14 is one');
  assert.equal(negRuns(), 1, '-0 → 0 notified once');
});
