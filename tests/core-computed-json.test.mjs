/**
 * **A computed's JSON is its value** (Brian's ruling, 2026-11-11). Its internals are own properties, so
 * `JSON.stringify` of a computed, or of a store holding one, listed them (its function, its cache, its hook) where the
 * value was meant. `toJSON` returns the value now. PIN: `Object.keys` still sees the internals (hiding them from every
 * enumeration cost creation 3.6–34%; the README says so). CONTROL: a signal's JSON is its value too, as it already was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, computed, signal } = await load('core');

test('JSON of a computed, and of a store holding one, gives the value', () => {
  const s = createStore({ n: 2 });
  const double = computed(() => s.n * 2);
  assert.equal(JSON.stringify(double), '4');
  const holder = createStore({ total: double, label: 'x' });
  assert.equal(JSON.stringify(holder), '{"total":4,"label":"x"}');
  s.n = 5;
  assert.equal(JSON.stringify({ double }), '{"double":10}', 'the current value');
});

test('PIN: Object.keys still sees a computed\'s internals (read `.value`)', () => {
  const c = computed(() => 1);
  assert.ok(Object.keys(c).length > 0, 'the internals are own properties');
});

test('CONTROL: a signal\'s JSON is its value', () => {
  assert.equal(JSON.stringify({ a: signal(3) }), '{"a":3}');
});
