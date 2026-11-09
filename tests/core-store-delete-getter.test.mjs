/**
 * **Deleting a key never runs its getter**, as in the language: the store reads the value being deleted from the own
 * descriptor. A getter that throws made `delete store.k` throw. CONTROL: the key is gone and its readers wake.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, effect } = await load('core');

test('delete on a key whose getter throws: no throw, the key is gone, its readers wake', () => {
  let reads = 0;
  const raw = Object.defineProperty({ a: 1 }, 'bad', { get() { reads++; throw new Error('getter ran'); }, configurable: true, enumerable: true });
  const s = createStore(raw);
  let runs = 0;
  effect(() => { void ('bad' in s); runs++; }, { owner: {}, timing: 'sync' }).run();
  assert.doesNotThrow(() => { delete s.bad; });
  assert.equal(reads, 0, 'the getter never ran');
  assert.ok(!Object.hasOwn(raw, 'bad'));
  assert.equal(runs, 2, 'CONTROL: the `in` reader woke');
});
