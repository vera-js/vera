/**
 * **Deleting a key the object only INHERITS changes nothing, so it wakes nobody.** The language leaves an inherited key
 * where it is; the store woke the key's readers and the shape's anyway. CONTROL: deleting an own key wakes both.
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

test('delete of an inherited-only key wakes nobody; delete of an own key wakes its readers', () => {
  const raw = Object.create({ inherited: 1 });
  raw.own = 2;
  const s = createStore(raw);
  const inherited = watch(() => s.inherited);
  const shape = watch(() => Object.keys(s));
  delete s.inherited;
  assert.equal(s.inherited, 1, 'still there: delete never touches an inherited key');
  assert.deepEqual([inherited(), shape()], [0, 0]);
  const own = watch(() => s.own);
  delete s.own;
  assert.deepEqual([own(), shape()], [1, 1], 'CONTROL: an own key deleted wakes its reader and the shape');
});

test('the same on a store array: deleting an inherited-only index key wakes nobody', () => {
  const raw = [1, 2];
  Object.setPrototypeOf(raw, Object.assign(Object.create(Array.prototype), { 5: 'p' }));
  const s = createStore(raw);
  const shape = watch(() => Object.keys(s));
  delete s[5];
  assert.equal(shape(), 0, 'its shape readers are not woken');
  const own = watch(() => s[0]);
  delete s[0];
  assert.deepEqual([own(), shape()], [1, 1], 'CONTROL: an own index deleted wakes its reader and the shape');
});
