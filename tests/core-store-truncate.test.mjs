/**
 * **A truncating `length = n` wakes the readers of the indices it drops, and the key set's.** The language deletes the
 * indices past `n` without any index write, so no index trap fires; the store tells their readers itself. CONTROL: a
 * reader of an index that stays is not woken, and a growing `length` drops nothing.
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

test('length = n wakes the readers of the dropped indices and of the key set; an index that stays is not woken', () => {
  const s = createStore({ list: ['a', 'b', 'c', 'd'] });
  const list = s.list;
  const dropped = watch(() => list[3]);
  const kept = watch(() => list[0]);
  const keys = watch(() => Object.keys(list));
  list.length = 2;
  assert.equal(list[3], undefined);
  assert.deepEqual([dropped(), keys(), kept()], [1, 1, 0]);
});

test('CONTROL: a growing length drops no index', () => {
  const s = createStore({ list: ['a'] });
  const list = s.list;
  const first = watch(() => list[0]);
  list.length = 3;
  assert.equal(first(), 0);
});
