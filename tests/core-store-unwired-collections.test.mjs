/**
 * **A store of a type nothing claims is USABLE, and not reactive** (D11, Brian's ruling 2026-11-11; the rebuild's form).
 * `createStore(new Map())` before `collections` is wired: every method threw ("called on incompatible receiver": a
 * native method refuses a proxy as `this`). Now its methods run on the real object, cached so `m.get === m.get`, and a
 * method returning its object (`set`, `add`) returns the store. Nothing updates until a module claims the type; then
 * the same store is reactive (CONTROL, run in a process of its own so this file's unwired cases stay unwired).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { load, isProduction } from './dist.mjs';

const { createStore } = await load('core');
const quiet = (run) => {
  const error = console.error;
  console.error = () => {};
  try { return run(); } finally { console.error = error; }
};

test('an unwired Map store works: set, get, size, has, delete, iteration; methods are stable; set returns the store', () => {
  const m = quiet(() => createStore(new Map([['a', 1]])));
  assert.equal(m.set('b', 2), m, 'set returns the store, so a chain stays on it');
  assert.equal(m.get('b'), 2);
  assert.equal(m.size, 2);
  assert.equal(m.has('a'), true);
  assert.equal(m.delete('a'), true);
  assert.deepEqual([...m], [['b', 2]]);
  assert.equal(m.get, m.get, 'the same function on every read');
});

test('an unwired Set store works the same way', () => {
  const s = quiet(() => createStore(new Set([1])));
  assert.equal(s.add(2), s);
  assert.equal(s.size, 2);
  assert.equal(s.has(2), true);
  assert.deepEqual([...s.values()], [1, 2]);
});

test('CONTROL: wiring collections afterwards makes the same store reactive', () => {
  const out = execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--input-type=module', '-e', `
    const { load } = await import('./tests/dist.mjs');
    const { createStore, effect, wire } = await load('core');
    const { collections } = await load('store/collections');
    const error = console.error; console.error = () => {};
    const m = createStore(new Map([['a', 1]]));
    console.error = error;
    m.set('a', 2);
    wire([collections]);
    let runs = 0;
    effect(() => { void m.get('a'); runs++; }, { owner: {}, timing: 'sync' }).run();
    m.set('a', 3);
    console.log(JSON.stringify({ runs, value: m.get('a') }));
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env } });
  assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), { runs: 2, value: 3 });
});
