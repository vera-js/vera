/**
 * **`undefined` written to a key the object neither owns nor gets from a setter is a write the store makes**, as the
 * language does: the own key is created, `in`, `Object.keys` and `hasOwn` see it, and their readers wake. **A DEFINED value
 * the object inherits, written as itself, stays no change** (a decision: telling it apart cost every same-value write
 * 11–12%), so nothing wakes and no own key appears. Controls: a same-value write to an own key wakes nobody; through an
 * inherited setter it does not run the setter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, effect } = await load('core');
/** Runs `read` in a sync effect; returns how many times it re-ran. */
const watch = (read) => {
  let runs = 0;
  effect(() => { read(); runs++; }, { owner: {}, timing: 'sync' }).run();
  return () => runs - 1;
};

test('undefined written to an ABSENT key creates it: `in` and keys readers wake', () => {
  const raw = { a: 1 };
  const s = createStore(raw);
  const inRuns = watch(() => 'k' in s);
  const keyRuns = watch(() => Object.keys(s));
  s.k = undefined;
  assert.ok(Object.hasOwn(raw, 'k'), 'the own key exists, as a plain object would have it');
  assert.deepEqual(Object.keys(s), ['a', 'k']);
  assert.deepEqual([inRuns(), keyRuns()], [1, 1]);
});

test('an inherited data property holding undefined, written undefined, becomes own: keys readers wake', () => {
  const raw = Object.create({ x: undefined });
  const s = createStore(raw);
  const keyRuns = watch(() => Object.keys(s));
  s.x = undefined;
  assert.ok(Object.hasOwn(raw, 'x'));
  assert.deepEqual(Object.keys(s), ['x']);
  assert.equal(keyRuns(), 1);
});

test('BY DECISION: an inherited DEFINED value written as itself stays no change: no own key, nobody wakes', () => {
  const raw = Object.create({ x: 1 });
  const s = createStore(raw);
  const valueRuns = watch(() => s.x);
  const keyRuns = watch(() => Object.keys(s));
  s.x = 1;
  assert.equal(Object.hasOwn(raw, 'x'), false, 'the language would create it; the store does not, by decision');
  assert.deepEqual([valueRuns(), keyRuns()], [0, 0]);
  s.x = 2;
  assert.ok(Object.hasOwn(raw, 'x'), 'CONTROL: a different value is a write');
  assert.deepEqual([valueRuns(), keyRuns()], [1, 1]);
});

test('CONTROLS: the same value under an own key wakes nobody; through an inherited setter the setter does not run', () => {
  const s = createStore({ a: 1, u: undefined });
  const runs = watch(() => { void s.a; void s.u; void Object.keys(s); });
  s.a = 1;
  s.u = undefined;
  assert.equal(runs(), 0, 'nothing changed');
  let sets = 0;
  const proto = { get v() { return 7; }, set v(_) { sets++; } };
  const t = createStore(Object.create(proto));
  t.v = 7;
  assert.equal(sets, 0, 'the getter already returns it');
  t.v = 8;
  assert.equal(sets, 1, 'CONTROL: a different value runs the setter');
});
