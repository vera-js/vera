/**
 * **A whole-array method that THROWS still notifies** (D8, 2026-11-10): a `sort` whose comparator throws, or a
 * subclass's override, may have rewritten some slots before the error (engines differ in how much), so every slot it
 * could have touched, the walkers and the key set are told, and the error then propagates. CONTROL: a sort that completes
 * notifies once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, effect } = await load('core');
const watch = (read) => {
  let runs = 0;
  effect(() => { read(); runs++; }, { owner: {}, timing: 'sync' }).run();
  return () => runs - 1;
};

test('a sort whose comparator throws wakes every slot and the walkers; the error propagates', () => {
  const s = createStore({ list: [5, 4, 3, 2, 1] });
  const list = s.list;
  const slots = [0, 1, 2, 3, 4].map((i) => watch(() => list[i]));
  const walk = watch(() => list.map((x) => x));
  let calls = 0;
  assert.throws(() => list.sort((a, b) => {
    if (++calls === 3) throw new Error('comparator');
    return a - b;
  }), /comparator/);
  assert.deepEqual(slots.map((r) => r()), [1, 1, 1, 1, 1], 'every slot woke');
  assert.equal(walk(), 1, 'the walker woke');
});

test('CONTROL: a sort that completes notifies once', () => {
  const s = createStore({ list: [3, 1, 2] });
  const list = s.list;
  const walk = watch(() => list.map((x) => x));
  list.sort((a, b) => a - b);
  assert.deepEqual([...list], [1, 2, 3]);
  assert.equal(walk(), 1);
});
