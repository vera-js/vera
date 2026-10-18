/**
 * **A store's cache field on a raw object is invisible, and never breaks the language's rules** (2026-10-18). Core keeps
 * a raw object's store version ON it, under a Symbol private to each copy of core, instead of only in a WeakMap (a
 * WeakMap lookup was most of a store list's walk in Firefox). These rows pin what that must never change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore } = await load('core');

test('the field is invisible through the store: keys, spread, JSON, symbols', () => {
  const state = createStore({ o: { a: 1, b: 2 } });
  const o = state.o;
  assert.deepEqual(Object.keys(o), ['a', 'b']);
  assert.deepEqual({ ...o }, { a: 1, b: 2 });
  assert.equal(JSON.stringify(o), '{"a":1,"b":2}');
  assert.deepEqual(Object.getOwnPropertySymbols(o), []);
  assert.deepEqual(Reflect.ownKeys(o), ['a', 'b']);
});

test('and through the raw object, to everything but an explicit symbol query', () => {
  const raw = { a: 1 };
  const state = createStore({ o: raw });
  void state.o;
  assert.deepEqual(Object.keys(raw), ['a']);
  assert.deepEqual({ ...raw }, { a: 1 });
  assert.equal(JSON.stringify(raw), '{"a":1}');
  assert.equal(structuredClone(raw).a, 1);
});

test('identity holds: one proxy per object, as before', () => {
  const state = createStore({ o: { a: 1 }, list: [{ id: 1 }] });
  assert.equal(state.o, state.o);
  assert.equal(state.list[0], state.list[0]);
  assert.equal(createStore(state.o), state.o);
});

test('an object freezing ITSELF after the field exists does not make enumeration throw', () => {
  const raw = { a: 1 };
  const state = createStore({ o: raw });
  const o = state.o;
  Object.freeze(raw);
  assert.doesNotThrow(() => Reflect.ownKeys(o));
  assert.doesNotThrow(() => ({ ...o }));
  assert.equal(o.a, 1);
});

test('preventExtensions THROUGH the store moves the cache to the WeakMap; identity and enumeration survive', () => {
  const raw = { a: 1 };
  const state = createStore({ o: raw });
  const o = state.o;
  Object.preventExtensions(o);
  assert.deepEqual(Object.getOwnPropertySymbols(raw), [], 'the field left the raw object');
  assert.equal(state.o, o, 'the same proxy, now from the WeakMap');
  assert.deepEqual(Reflect.ownKeys(o), ['a']);
});

test('an object frozen BEFORE it reaches the store keeps today\'s WeakMap path', () => {
  const state = createStore({ o: Object.freeze({ a: { b: 1 } }) });
  assert.equal(state.o, state.o);
  assert.equal(state.o.a.b, 1);
});

test('an object that only INHERITS from a stored one gets its OWN store version', () => {
  const parent = { a: 1 };
  const state = createStore({ p: parent });
  void state.p;
  const child = Object.create(parent);
  child.b = 2;
  state.c = child;
  assert.notEqual(state.c, state.p);
  assert.equal(state.c.b, 2);
  assert.equal(state.c.a, 1);
});

test('two copies of core keep separate fields on one shared raw object', async () => {
  const other = await load('core', '?copy=field');
  const raw = { a: 1 };
  const one = createStore({ o: raw });
  const two = other.createStore({ o: raw });
  assert.notEqual(one.o, two.o, 'each copy wraps it itself');
  assert.equal(one.o, one.o);
  assert.equal(two.o, two.o);
  assert.equal(Object.getOwnPropertySymbols(raw).length, 2);
});
