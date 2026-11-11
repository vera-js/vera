/**
 * **`snapshot(value)`: a deep plain copy for cloning and export** (Brian: A4, and D5 on the base 2026-11-08).
 * A record written into a store is stored as given, so raw data can hold stores, which can't be cloned; a snapshot can.
 * The CONTROL row proves the raw data really fails to clone, so the snapshot rows mean something.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, snapshot } = await load('core');
const clones = (value) => { try { structuredClone(value); return true; } catch { return false; } };

test('CONTROL: raw data holding a store does not clone', () => {
  const data = { k: null };
  const state = createStore(data);
  state.k = { child: createStore({ v: 1 }) };
  assert.equal(clones(data), false);
});

test('a snapshot clones, a store one level and two levels down', () => {
  const state = createStore({ k: null });
  state.k = { child: createStore({ v: 1 }), deep: { child: createStore({ v: 2 }) } };
  const copy = structuredClone(snapshot(state));
  assert.deepEqual([copy.k.child.v, copy.k.deep.child.v], [1, 2]);
});

test('a snapshot copies a Map and a Set with their entries, stores inside included', () => {
  const inner = createStore({ v: 3 });
  const out = snapshot(createStore({ m: new Map([['a', { inner }]]), s: new Set([inner]) }));
  assert.ok(clones(out));
  assert.ok(out.m instanceof Map && out.s instanceof Set);
  assert.equal(out.m.get('a').inner.v, 3);
});

test('a snapshot keeps a cycle, is a copy, keeps arrays arrays and a class instance as given', () => {
  const d = { n: 1 };
  d.self = d;
  const out = snapshot(createStore(d));
  assert.equal(out.self, out);
  assert.notEqual(out, d);
  assert.ok(Array.isArray(snapshot(createStore({ l: [1] })).l));
  class Thing { x = 1; }
  const t = new Thing();
  assert.equal(snapshot(createStore({ t })).t, t);
});

test('an own `__proto__` key (as JSON.parse makes) is copied as a key; the copy keeps its prototype', () => {
  const parsed = JSON.parse('{"__proto__": {"polluted": 1}, "a": 2}');
  const out = snapshot(createStore({ x: parsed })).x;
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.ok(Object.hasOwn(out, '__proto__'));
  assert.equal(out.polluted, undefined);
  assert.equal(out.a, 2);
});
