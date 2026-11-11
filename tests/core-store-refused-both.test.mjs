/**
 * **A write or delete the language refuses throws, in BOTH builds** (Brian's ruling, 2026-11-08), even from sloppy-mode code,
 * which would otherwise lose it silently, and through `Reflect.set` / `Reflect.deleteProperty`, which would otherwise
 * answer `false` (B3 changes that answer on purpose; the README says so). The error is a TypeError coded `store-refused`. CONTROL: a write the language
 * allows succeeds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore } = await load('core');
/** Sloppy-mode code: a refused assignment is silently ignored by the language itself, not thrown. */
const sloppyWrite = new Function('s', 'k', 'v', 's[k] = v;');
const sloppyDelete = new Function('s', 'k', 'return delete s[k];');

test('a refused write throws, even from sloppy code: frozen, non-writable, getter without setter', () => {
  assert.throws(() => sloppyWrite(createStore(Object.freeze({ x: 1 })), 'x', 2), (e) => e instanceof TypeError && /store-refused/.test(e.message));
  const ro = {};
  Object.defineProperty(ro, 'x', { value: 1, writable: false, configurable: true, enumerable: true });
  assert.throws(() => sloppyWrite(createStore(ro), 'x', 2), /store-refused/);
  assert.throws(() => sloppyWrite(createStore({ get x() { return 1; } }), 'x', 2), /store-refused/);
});

test('a refused delete throws, even from sloppy code', () => {
  assert.throws(() => sloppyDelete(createStore(Object.seal({ x: 1 })), 'x'), /store-refused/);
});

test('through Reflect: a refused set and a refused delete throw, where a plain object answers false', () => {
  assert.equal(Reflect.set(Object.freeze({ x: 1 }), 'x', 2), false, 'CONTROL: the language answers false on a plain object');
  assert.equal(Reflect.deleteProperty(Object.seal({ x: 1 }), 'x'), false, 'CONTROL: and on a delete');
  assert.throws(() => Reflect.set(createStore(Object.freeze({ x: 1 })), 'x', 2), /store-refused/);
  assert.throws(() => Reflect.deleteProperty(createStore(Object.seal({ x: 1 })), 'x'), /store-refused/);
  assert.equal(Reflect.set(createStore({ x: 1 }), 'x', 2), true, 'CONTROL: an allowed Reflect.set answers true');
});

test('CONTROL: a write the language allows succeeds', () => {
  const s = createStore({ x: 1 });
  sloppyWrite(s, 'x', 2);
  assert.equal(s.x, 2);
});
