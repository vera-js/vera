/**
 * **A store isn't meant to be a prototype: a documented limit** (Brian's ruling, 2026-11-11; the README says so, with
 * workarounds). A write through `Object.create(store)` to a key the child does not own lands in the store, where the
 * language would put it on the child; telling the two apart cost every changing store write 1.2–2.4% (measured), so the
 * store does not. PIN: a child write without an own key lands in the parent; WITH an own key it stays on the child (the
 * first workaround). If the first test turns red the limit closed, and the README section goes with it. CONTROL: on a
 * plain prototype the language puts the write on the child.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, effect } = await load('core');

test('PIN: a child write to a key it does not own lands in the store, and wakes its readers', () => {
  const store = createStore({ k: 1 });
  let runs = 0;
  effect(() => { void store.k; runs++; }, { owner: {}, timing: 'sync' }).run();
  const child = Object.create(store);
  child.k = 5;
  assert.equal(store.k, 5, 'the write landed in the store');
  assert.equal(Object.hasOwn(child, 'k'), false, 'the child has no own key');
  assert.equal(runs, 2, 'the store\'s reader woke');
});

test('a child with its own key keeps the write; a key it does not own reads through', () => {
  const store = createStore({ k: 1, other: 2 });
  const child = Object.create(store, { k: { value: 1, writable: true, enumerable: true, configurable: true } });
  child.k = 9;
  assert.equal(child.k, 9);
  assert.equal(store.k, 1, 'the store is untouched');
  assert.equal(child.other, 2, 'a key the child does not own reads through');
});

test('CONTROL: over a plain prototype the language puts the write on the child', () => {
  const parent = { k: 1 };
  const child = Object.create(parent);
  child.k = 5;
  assert.equal(parent.k, 1);
  assert.equal(Object.hasOwn(child, 'k'), true);
});
