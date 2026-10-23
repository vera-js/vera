/**
 * **A collection's `clear()` is ONE operation** (A14, 2026-10-22): every key's readers and the shape channel's are woken
 * under one wake number, so a hook reached through many keys runs once — it ran once per key. Raw hooks (inside the
 * write) are where it showed; a queued render coalesced anyway. Counts are exact, each with its control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const core = await load('core');
const { collections } = await load('store/collections');
core.wire([collections]);
const { createStore, computed } = core;
/** The raw hook primitive is core-internal since `effect` (2026-10-22): reached through core's own hand-off, `$s[2]`. */
const createHook = core.inserts.$s[2];
/** A raw hook (it runs inside every write it hears), counting its runs after the first. */
const watch = (read) => {
  let runs = 0;
  const run = createHook({ element: {}, priority: 10, callback: () => { read(); runs++; } });
  run(undefined, true);
  return () => runs - 1;
};
const filled = (n) => new Map(Array.from({ length: n }, (_, i) => [i, i]));

test('a hook reading 100 keys runs ONCE on clear (it ran 100 times)', () => {
  const s = createStore({ m: filled(100) });
  const runs = watch(() => { for (let i = 0; i < 100; i++) s.m.get(i); });
  s.m.set(0, 99);
  assert.equal(runs(), 1, 'CONTROL: one write, one run');
  s.m.clear();
  assert.equal(runs(), 2, 'the clear: exactly one more');
});

test('a computed over 100 keys re-evaluates once', () => {
  const s = createStore({ m: filled(100) });
  let evals = 0;
  const sum = computed(() => { evals++; let t = 0; for (let i = 0; i < 100; i++) t += s.m.get(i) ?? 0; return t; });
  const runs = watch(() => sum.value);
  const before = evals;
  s.m.clear();
  assert.equal(evals - before, 1);
  assert.equal(sum.value, 0);
  assert.equal(runs(), 1, 'and its reader ran once');
});

test('a partly read Map: only the read keys’ readers and the shape’s readers wake, each once', () => {
  const s = createStore({ m: filled(10) });
  const a = watch(() => s.m.get(2));
  const b = watch(() => s.m.get(7));
  const shape = watch(() => s.m.size);
  const iter = watch(() => { for (const _ of s.m); });
  s.m.clear();
  assert.deepEqual([a(), b(), shape(), iter()], [1, 1, 1, 1]);
});

test('clearing an empty Map wakes nobody', () => {
  const s = createStore({ m: new Map() });
  const shape = watch(() => s.m.size);
  s.m.clear();
  assert.equal(shape(), 0);
  s.m.set(1, 1);
  assert.equal(shape(), 1, 'CONTROL: a real change does');
});

test('a Set’s clear is one operation too', () => {
  const s = createStore({ set: new Set([1, 2, 3, 4, 5]) });
  const runs = watch(() => { for (let i = 1; i <= 5; i++) s.set.has(i); });
  s.set.clear();
  assert.equal(runs(), 1);
});
