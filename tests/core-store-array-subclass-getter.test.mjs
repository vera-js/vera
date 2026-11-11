/**
 * **A getter on an Array subclass sees the raw array: a documented limit** (Brian's ruling, 2026-11-11; the README says
 * so). `class List extends Array { get first() { return this[0]; } }` in a store reads the right value, but the getter
 * runs with the RAW array as `this`, so a hook reading it is not woken by an index write. Running it with the store as
 * `this` cost array creation 1.5–3% (measured), so it is not done. PIN: the value is right and the getter's read is
 * untracked; if this row turns red the limit closed, and the README paragraph goes with it. CONTROL: the index read,
 * and a getter on a plain record, are both woken by the same writes.
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
class List extends Array {
  get first() { return this[0]; }
}

test('PIN: an Array subclass getter reads the right value, untracked', () => {
  const s = createStore({ list: List.from([1, 2]) });
  const viaGetter = watch(() => s.list.first);
  const viaIndex = watch(() => s.list[0]);
  s.list[0] = 9;
  assert.equal(s.list.first, 9, 'the value is right');
  assert.equal(viaIndex(), 1, 'CONTROL: the index read woke');
  assert.equal(viaGetter(), 0, 'the getter read did not (the documented limit)');
});

test('CONTROL: a getter on a plain record runs with the store as `this` and is tracked', () => {
  const s = createStore({ rec: { a: 1, get double() { return this.a * 2; } } });
  const viaGetter = watch(() => s.rec.double);
  s.rec.a = 5;
  assert.equal(s.rec.double, 10);
  assert.equal(viaGetter(), 1);
});
