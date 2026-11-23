/**
 * **`Object.defineProperty` on a store array moves `length` as a write does** (2026-11-23). An index defined at or past
 * the end grows `length`, and `length` defined shorter deletes the indices past it, neither through an index or
 * `length` trap of its own. The `set` trap tells their readers; the define trap told nobody, so an effect reading
 * `length`, a dropped index or the whole array kept what it read. The `set` rows are the control.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

const { createStore, effect, flush } = await load('core');
const DATA = { value: 3, writable: true, enumerable: true, configurable: true };

test('an effect reading length, an index or the whole array sees a define that moves length', () => {
  for (const [label, read, write] of [
    ['CONTROL: set an index at length', (a) => JSON.stringify(a), (a) => { a[2] = 3; }],
    ['CONTROL: push', (a) => a.length, (a) => a.push(3)],
    ['define an index at length (whole array)', (a) => JSON.stringify(a), (a) => Object.defineProperty(a, 2, DATA)],
    ['define an index at length (length)', (a) => a.length, (a) => Object.defineProperty(a, 2, DATA)],
    ['define an index past length (length)', (a) => a.length, (a) => Object.defineProperty(a, 5, DATA)],
    ['define length shorter (whole array)', (a) => JSON.stringify(a), (a) => Object.defineProperty(a, 'length', { value: 1 })],
    ['define length shorter (a dropped index)', (a) => a[1], (a) => Object.defineProperty(a, 'length', { value: 1 })],
    ['Reflect.defineProperty grows (spread)', (a) => [...a].join(), (a) => Reflect.defineProperty(a, 2, { ...DATA, value: 9 })],
    ['define length longer (length)', (a) => a.length, (a) => Object.defineProperty(a, 'length', { value: 10 })],
    ['define length 0 (whole array)', (a) => JSON.stringify(a), (a) => Object.defineProperty(a, 'length', { value: 0 })],
    ['define length 0 (index 0)', (a) => a[0], (a) => Object.defineProperty(a, 'length', { value: 0 })],
  ]) {
    const store = createStore({ arr: [1, 2] });
    let seen;
    effect(() => { seen = read(store.arr); }, { owner: {} })?.run();
    write(store.arr);
    flush();
    assert.deepEqual(seen, read(store.arr), label);
  }
});

/** One define, one wake (`core-store-one-write-one-wake`): a hook reading the new index and `length` runs once, as for `set`. */
test("an index or length defined past the end runs a 'sync' hook that read the index and length once", () => {
  for (const [label, write] of [
    ['CONTROL: set', (list) => { list[3] = 'd'; }],
    ['define', (list) => Object.defineProperty(list, 3, { ...DATA, value: 'd' })],
    ['define length longer', (list) => Object.defineProperty(list, 'length', { value: 5 })],
  ]) {
    const list = createStore({ l: ['a'] }).l;
    let runs = 0;
    effect(() => { void list[3]; void list.length; runs++; }, { owner: {}, timing: 'sync' }).run();
    write(list);
    assert.equal(runs - 1, 1, label);
  }
});
