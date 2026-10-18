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

test('a store written into a store is stored RAW, and reads back as the same proxy', () => {
  const rawO = { a: 1 };
  const rawList = [{ id: 1 }, { id: 2 }];
  const state = createStore({ o: rawO, list: rawList });
  const o = state.o;
  state.list[0] = o;
  assert.equal(rawList[0], rawO, 'assignment stored the raw object');
  assert.equal(state.list[0], o, 'and a read hands back the same proxy');
  state.list.push(o);
  assert.equal(rawList[2], rawO, 'push stored it raw too');
  state.list.splice(1, 0, o);
  assert.equal(rawList[1], rawO, 'and splice');
  state.other = state.list;
  assert.equal(state.other, state.list);
});

test('a store of another kind (shallow) is kept as it is', async () => {
  const { shallowRef } = await load('core');
  const ref = shallowRef({ deep: { x: 1 } });
  const raw = {};
  const state = createStore({ box: raw });
  state.box.ref = ref;
  assert.equal(raw.ref, ref, 'a shallow ref is not unwrapped');
});

test("a store from ANOTHER copy of core is stored as given (it does not answer this copy's RAW)", async () => {
  const other = await load('core', '?copy=raw');
  const foreign = other.createStore({ x: 1 });
  const raw = {};
  const state = createStore({ box: raw });
  state.box.f = foreign;
  assert.equal(raw.f, foreign);
});

test('a store Map (the collections module) is stored as a proxy, as before', async () => {
  const { collections } = await load('store/collections');
  const { wire } = await load('core');
  wire([collections]);
  const state = createStore({ m: new Map([[1, 'a']]), box: {} });
  const m = state.m;
  const rawBox = {};
  state.box2 = rawBox;
  state.box2.m = m;
  assert.equal(rawBox.m, m, 'the collections handler does not answer RAW, so the proxy is kept');
  assert.equal(state.box2.m.get(1), 'a');
});

test('a data record\'s fast write still runs a setter defined THROUGH the store with the store as `this`', () => {
  const state = createStore({ o: { a: 1, seen: 0 } });
  const o = state.o;
  o.a = 2; // classified a data record
  Object.defineProperty(o, 'b', { get() { return this.a; }, set(v) { this.a = v; this.seen++; }, configurable: true });
  o.b = 5;
  assert.equal(o.a, 5);
  assert.equal(o.seen, 1, 'the setter ran once, with the proxy as `this` (its writes went through the store)');
});

test("'__proto__' assigned through a data record goes the full way: a later setter write still notifies", async () => {
  const { createHook } = await load('core');
  const state = createStore({ o: { a: 1, n: 0 } });
  state.o.a = 2; // classified a data record
  state.o.__proto__ = { set x(v) { this.n = v; } };
  let runs = 0;
  const owner = { _$g$: 1, _$x$: false, localName: 'probe', isConnected: true };
  createHook({ priority: 50, element: owner, callback: () => { runs++; void state.o.n; } })();
  runs = 0;
  state.o.x = 7;
  assert.equal(state.o.n, 7);
  assert.equal(runs, 1, 'the setter ran with the store as `this`, so its write was heard');
  assert.equal(({}).x, undefined, 'Object.prototype untouched');
});

test('a prototype replaced THROUGH the store is honored: its setter gets the store as `this`', () => {
  const state = createStore({ o: { a: 1, n: 0 } });
  const o = state.o;
  o.a = 2; // classified
  Object.setPrototypeOf(o, { set x(v) { this.n = v; } });
  o.x = 7;
  assert.equal(o.n, 7);
  assert.equal(Object.hasOwn(o, 'x'), false, 'the setter ran, nothing was defined on the record');
});
