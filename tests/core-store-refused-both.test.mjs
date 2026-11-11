/**
 * **A write or delete the language refuses throws, in BOTH builds** (D14, ruled 2026-11-08), even from sloppy-mode code,
 * which would otherwise lose it silently. The error is a TypeError coded `store-refused`. CONTROL: a write the language
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

test('CONTROL: a write the language allows succeeds', () => {
  const s = createStore({ x: 1 });
  sloppyWrite(s, 'x', 2);
  assert.equal(s.x, 2);
});
