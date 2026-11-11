/**
 * **A subclass's own mutator runs with the raw array as `this`: a documented limit, said in development** (Brian's
 * ruling, 2026-11-11; the README says so). An override that writes a field of its own (`this.added++` inside `push`)
 * writes the raw array, so a reader of that field is not woken; the items and the length are (the store notifies them
 * for every mutator). Running the override with the store as `this` cost a plain array's `push` 8–15% on V8 (measured),
 * so it is not done. Development says so ONCE per class (`subclass-mutator`), only where a store first meets such a
 * subclass. PIN: the field's reader is not woken; if this turns red the limit closed. CONTROL: the length's reader is,
 * and a plain array or a subclass with no mutator of its own says nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, isProduction } from './dist.mjs';

const { createStore, effect } = await load('core');
const watch = (read) => {
  let runs = 0;
  effect(() => { read(); runs++; }, { owner: {}, timing: 'sync' }).run();
  return () => runs - 1;
};
const said = (run) => {
  const lines = [];
  const error = console.error;
  console.error = (line) => lines.push(String(line));
  try { run(); } finally { console.error = error; }
  return lines.filter((line) => line.includes('subclass-mutator'));
};

class Log extends Array {
  push(...items) { this.added = (this.added ?? 0) + items.length; return super.push(...items); }
}

test('PIN: a field the override writes is not tracked; the length is', () => {
  let s;
  said(() => { s = createStore({ log: Log.from(['a']) }); void s.log; });
  const added = watch(() => s.log.added);
  const length = watch(() => s.log.length);
  s.log.push('b');
  assert.equal(s.log.added, 1, 'the field was written');
  assert.equal(length(), 1, 'CONTROL: the length reader woke');
  assert.equal(added(), 0, 'the field reader did not (the documented limit)');
});

test('development says it once per class, naming the class; production says nothing', () => {
  class Queue extends Array { shift() { return super.shift(); } }
  const first = said(() => { const s = createStore({ q: Queue.from([1]) }); void s.q; });
  const again = said(() => { const s = createStore({ q: Queue.from([2]) }); void s.q; });
  assert.equal(first.length, isProduction ? 0 : 1, 'said on the first store that meets the class');
  if (!isProduction) assert.match(first[0], /Queue/);
  assert.equal(again.length, 0, 'once per class');
});

test('CONTROL: a plain array, and a subclass with no mutator of its own, say nothing', () => {
  class Tagged extends Array { get first() { return this[0]; } }
  const lines = said(() => { const s = createStore({ a: [1], t: Tagged.from([1]) }); void s.a; void s.t; });
  assert.equal(lines.length, 0);
});

test('PIN: a store made FROM the subclass itself is not checked (the documented gap)', () => {
  /** Checked where a store first meets an array inside it; covering a store's own root would reorder the production bundle. If this turns red, the gap closed: update the README sentence. */
  class Stack extends Array { pop() { return super.pop(); } }
  const lines = said(() => { const s = createStore(Stack.from([1, 2])); void s.length; });
  assert.equal(lines.length, 0);
  const inside = said(() => { const s = createStore({ s: Stack.from([1]) }); void s.s; });
  assert.equal(inside.length, isProduction ? 0 : 1, 'CONTROL: the same class held inside a store is said');
});
