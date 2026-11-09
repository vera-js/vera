/**
 * **A mutator read from a store array is a fresh function on every read, by decision** (2026-11-08): `list.push ===
 * list.push` is false, unlike a plain array's. A stable wrapper per name was built and counted, and it cost a `push` on an
 * unread array 18–35% (instructions), or module state that kept an array alive; identity bought nothing a program relies
 * on. This row pins the decision: a change that makes them equal is noticed here and asked again, never slipped in.
 * What the wrapper DOES is pinned too: called on its own array it runs whole and notifies once; borrowed onto another
 * array it runs as that array's own method would.
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

test('BY DECISION: each read of a mutator is a new function (list.push !== list.push), and not the native one', () => {
  const s = createStore({ a: [1], b: [2] });
  assert.equal(s.a.push === s.a.push, false);
  assert.equal(s.a.splice === s.b.splice, false);
  assert.equal(s.a.push === Array.prototype.push, false);
});

test('borrowed onto another store array: that array is written; onto a plain array: the native method', () => {
  const s = createStore({ a: [1], b: [2] });
  s.a.push.call(s.b, 3, 4);
  assert.deepEqual([[...s.a], [...s.b]], [[1], [2, 3, 4]]);
  const plain = [9];
  s.a.push.call(plain, 10);
  assert.deepEqual(plain, [9, 10]);
});

test('CONTROL: called on its own array it runs whole and notifies once', () => {
  const s = createStore({ a: [1] });
  const runs = watch(() => s.a.length);
  assert.equal(s.a.push(2, 3), 3);
  assert.equal(runs(), 1);
});
