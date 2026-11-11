/**
 * **One write wakes a hook once, however many of its channels the write changes.** A key added (or deleted, or defined
 * new) changes the key AND the key set; a hook that read both, as a render reads a field and lists the keys, runs once
 * per write, as it does for a whole-array method. CONTROL: an own key overwritten changes one channel and runs it once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, effect } = await load('core');
/** A sync hook reading `s.x` and the key set of `s`; returns how many times one `write` re-ran it. */
const runsOf = (initial, write) => {
  const s = createStore(initial);
  let runs = 0;
  effect(() => { void s.x; void Object.keys(s); runs++; }, { owner: {}, timing: 'sync' }).run();
  write(s);
  return runs - 1;
};

test('a key added, deleted or defined new runs a hook that read the key and the key set ONCE', () => {
  assert.equal(runsOf({}, (s) => { s.x = 2; }), 1, 'added');
  assert.equal(runsOf({ x: 1 }, (s) => { delete s.x; }), 1, 'deleted');
  assert.equal(runsOf({}, (s) => { Object.defineProperty(s, 'x', { value: 1, writable: true, enumerable: true, configurable: true }); }), 1, 'defined');
});

test('an index past the end runs a hook that read it, length and the key set ONCE', () => {
  const list = createStore({ l: ['a'] }).l;
  let runs = 0;
  effect(() => { void list[3]; void list.length; void Object.keys(list); runs++; }, { owner: {}, timing: 'sync' }).run();
  list[3] = 'd';
  assert.equal(runs - 1, 1);
});

test('CONTROL: an own key overwritten runs it once', () => {
  assert.equal(runsOf({ x: 1 }, (s) => { s.x = 2; }), 1);
});
