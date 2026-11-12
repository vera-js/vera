/**
 * **The same value onto a frozen or read-only key is no change: a documented limit, reported in development** (D14b,
 * Brian's ruling 2026-11-11). The language would refuse such a write, but it would leave everything as it was, so the
 * store treats it as any same-value write: no throw, no notification (a check on that path cost every same-value write
 * 3–71%, measured). Development reports it once per key per object (`same-onto-locked`). A write that CHANGES a
 * read-only key still throws `store-refused` in both builds (D14). CONTROL: a same-value write onto a writable key says
 * nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, isProduction } from './dist.mjs';

const { createStore, effect } = await load('core');
const sloppyWrite = new Function('s', 'k', 'v', 's[k] = v;');
const said = (run) => {
  const lines = [];
  const error = console.error;
  console.error = (line) => lines.push(String(line));
  try { run(); } finally { console.error = error; }
  return lines.filter((line) => line.includes('same-onto-locked'));
};

test('the same value onto a frozen key: no throw, no notification; development reports it once per key', () => {
  const s = createStore({ f: Object.freeze({ x: 1, y: 2 }) });
  let runs = 0;
  effect(() => { void s.f.x; runs++; }, { owner: {}, timing: 'sync' }).run();
  const lines = said(() => {
    sloppyWrite(s.f, 'x', 1);
    sloppyWrite(s.f, 'x', 1);
    assert.equal(Reflect.set(s.f, 'y', 2), true, 'Reflect.set answers true: nothing changed');
  });
  assert.equal(runs, 1, 'no notification');
  assert.equal(lines.length, isProduction ? 0 : 2, 'development: once for x (written twice), once for y');
});

test('the same value onto a key defined non-writable: no throw; development reports it', () => {
  const ro = {};
  Object.defineProperty(ro, 'x', { value: 1, writable: false, configurable: true, enumerable: true });
  const s = createStore({ ro });
  const lines = said(() => sloppyWrite(s.ro, 'x', 1));
  assert.equal(lines.length, isProduction ? 0 : 1);
});

test('a write that CHANGES a frozen or read-only key still throws store-refused in both builds', () => {
  const s = createStore({ f: Object.freeze({ x: 1 }) });
  assert.throws(() => sloppyWrite(s.f, 'x', 2), /store-refused/);
});

test('CONTROL: the same value onto a writable key says nothing', () => {
  const s = createStore({ o: { x: 1 } });
  assert.equal(said(() => { s.o.x = 1; }).length, 0);
});
