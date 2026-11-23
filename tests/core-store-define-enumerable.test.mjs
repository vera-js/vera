/**
 * **Making an existing key enumerable or hidden changes the key set** (2026-11-23). `Object.keys` and `JSON.stringify`
 * list only enumerable keys, and the store told key-set readers only of a NEW key, so a define that flipped an
 * existing key's enumerability left them with the list they read. Adding a key is the control.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

const { createStore, effect, flush } = await load('core');
const keys = (o) => Object.keys(o).join();
const json = (o) => JSON.stringify(o);
const HIDDEN = { value: 1, enumerable: false, configurable: true, writable: true };

test('a key-set reader sees a define that makes an existing key enumerable or hidden', () => {
  for (const [label, setup, write, read] of [
    ['CONTROL: a key added', () => {}, (o) => { o.b = 2; }, keys],
    ['hidden made enumerable (keys)', (r) => Object.defineProperty(r, 'h', HIDDEN), (o) => Object.defineProperty(o, 'h', { ...HIDDEN, enumerable: true }), keys],
    ['hidden made an enumerable getter (JSON)', (r) => Object.defineProperty(r, 'h', HIDDEN), (o) => Object.defineProperty(o, 'h', { get: () => 7, enumerable: true, configurable: true }), json],
    ['enumerable hidden, same value (keys)', () => {}, (o) => Object.defineProperty(o, 'a', { value: 1, enumerable: false }), keys],
    ['enumerable hidden, same value (JSON)', () => {}, (o) => Object.defineProperty(o, 'a', { value: 1, enumerable: false }), json],
    ['CONTROL: enumerability unchanged, same value', () => {}, (o) => Object.defineProperty(o, 'a', { value: 1, enumerable: true }), keys],
  ]) {
    const raw = { a: 1 };
    setup(raw);
    const store = createStore({ o: raw });
    let seen;
    let runs = 0;
    effect(() => { seen = read(store.o); runs++; }, { owner: {} })?.run();
    write(store.o);
    flush();
    assert.equal(seen, read(store.o), label);
    if (label.startsWith('CONTROL: enumerability')) assert.equal(runs, 1, 'no change, no run');
  }
});
