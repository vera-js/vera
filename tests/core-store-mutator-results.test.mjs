/**
 * **What an array mutator hands back is the value a read of the index gives** (2026-11-11). `pop`, `shift` and `splice`
 * return the values they removed, and `sort` hands its comparator two values, all through the store; they went through
 * `createProxy`, which wraps any object behind its type's handler, so a `Date` (or a `Map` nothing claims) came back as
 * an empty proxy whose methods throw: `getTime()` "this is not a Date object", and `state.dates.sort((a, b) => a - b)`
 * threw. A read of the index decides by type and hands such a value back as it is; the results now take that same
 * decision. CONTROL: a plain object removed from the array is still a store (a write through it notifies).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, effect } = await load('core');
const quiet = (run) => {
  const error = console.error;
  console.error = () => {};
  try { return run(); } finally { console.error = error; }
};

test('a Date sorts, and comes back from pop, shift and splice as a Date', () => {
  const s = createStore({ d: [new Date(5), new Date(1), new Date(3)] });
  s.d.sort((a, b) => a - b);
  assert.deepEqual(s.d.map((x) => x.getTime()), [1, 3, 5], 'sorted through `a - b`');
  s.d.sort((a, b) => b.getTime() - a.getTime());
  assert.deepEqual(s.d.map((x) => x.getTime()), [5, 3, 1], 'sorted through getTime()');
  const popped = s.d.pop();
  assert.ok(popped instanceof Date && popped.getTime() === 1, 'pop');
  const shifted = s.d.shift();
  assert.ok(shifted instanceof Date && shifted.getTime() === 5, 'shift');
  const [spliced] = s.d.splice(0, 1);
  assert.ok(spliced instanceof Date && spliced.getTime() === 3, 'splice');
});

test('a Map nothing claims comes back from splice as itself, as a read of the index gives it', () => {
  const map = new Map([[1, 2]]);
  const s = quiet(() => createStore({ l: [map] }));
  assert.equal(quiet(() => s.l[0]), map, 'CONTROL: a read of the index hands it back as it is');
  const [out] = quiet(() => s.l.splice(0, 1));
  assert.equal(out, map);
  assert.equal(out.size, 1);
});

test('CONTROL: a plain object removed from the array is still a store', () => {
  const s = createStore({ l: [{ n: 1 }] });
  const row = s.l.pop();
  let runs = 0;
  effect(() => { void row.n; runs++; }, { owner: {}, timing: 'sync' }).run();
  row.n = 2;
  assert.equal(runs, 2, 'a write through the popped row notified its reader');
});
