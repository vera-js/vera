/**
 * **Only a LOCKED slot comes back as it is** (2026-11-11). The language requires a non-writable, non-configurable data
 * property to read back exactly as it is, so a store must not hand a substitute (a store) from one. Every slot of a
 * FROZEN object is locked; a SEALED object's slots are only non-configurable (still writable), and a preventExtensions
 * object's are neither. The store handed back raw every child of any non-extensible parent, so an object held in a
 * sealed or preventExtensions parent was not a store and a write inside it rendered nothing. Now the slot decides.
 * CONTROL: a frozen parent's child still comes back raw, with no development error (D15's error is for a slot locked
 * by `defineProperty` on an object that can still change).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore, effect } = await load('core');
const watch = (read) => {
  let runs = 0;
  effect(() => { read(); runs++; }, { owner: {}, timing: 'sync' }).run();
  return () => runs - 1;
};
const errors = (run) => {
  const lines = [];
  const error = console.error;
  console.error = (line) => lines.push(String(line));
  try { return [run(), lines]; } finally { console.error = error; }
};

for (const [label, lock] of [['preventExtensions', Object.preventExtensions], ['seal', Object.seal]]) {
  test(`a ${label} parent's child is a store, and a write inside it notifies`, () => {
    const child = { n: 1 };
    const s = createStore({ p: lock({ child }) });
    const read = s.p.child;
    assert.notEqual(read, child, 'handed back as a store, not the raw object');
    const woke = watch(() => s.p.child.n);
    s.p.child.n = 2;
    assert.equal(woke(), 1, 'the reader woke');
    assert.equal(child.n, 2);
  });
}

test('CONTROL: a frozen parent\'s child comes back as it is, with no development error', () => {
  const child = { n: 1 };
  const s = createStore({ p: Object.freeze({ child }) });
  const [read, lines] = errors(() => s.p.child);
  assert.equal(read, child, 'the raw object, as the language requires');
  assert.equal(lines.length, 0);
});

test('an array sealed in a store walks its items as stores; a frozen one as they are', () => {
  const row = { n: 1 };
  const s = createStore({ sealed: Object.seal([row]), frozen: Object.freeze([{ n: 1 }]) });
  assert.notEqual(s.sealed[0], row, 'a sealed array\'s item is a store');
  const woke = watch(() => s.sealed.map((r) => r.n).join());
  s.sealed[0].n = 3;
  assert.equal(woke(), 1, 'a walker of the sealed list woke on a write inside an item');
  assert.equal(Object.isFrozen(s.frozen) && s.frozen[0].n, 1);
});

test('through the store: Object.freeze makes the children come back as they are; Object.seal keeps them stores', () => {
  const frozenChild = { n: 1 };
  const sealedChild = { n: 1 };
  const s = createStore({ f: { child: frozenChild }, g: { child: sealedChild } });
  assert.notEqual(s.f.child, frozenChild, 'CONTROL: a store before the freeze');
  Object.freeze(s.f);
  assert.equal(s.f.child, frozenChild, 'frozen through the store: the raw object (the language requires it)');
  Object.seal(s.g);
  const woke = watch(() => s.g.child.n);
  s.g.child.n = 2;
  assert.notEqual(s.g.child, sealedChild, 'sealed through the store: still a store');
  assert.equal(woke(), 1);
});

test('PIN (a documented edge, on any parent): an object already a store through one slot, read from a LOCKED slot, throws', () => {
  /**
   * A slot locked with `defineProperty` is checked on the cache MISS (`nested`), once per value; a value first read as
   * a store through another slot is a cache HIT, and the engine refuses a store from the locked slot. The same on an
   * extensible parent and on a sealed one: only a FROZEN parent asks its slots on every read. If this turns green the
   * edge closed.
   */
  for (const lock of [(o) => o, Object.seal]) {
    const shared = { n: 1 };
    const parent = { open: shared };
    Object.defineProperty(parent, 'locked', { value: shared, writable: false, configurable: false, enumerable: true });
    const s = createStore({ p: lock(parent) });
    void s.p.open;
    assert.throws(() => s.p.locked, TypeError);
  }
});
