/**
 * **A locked slot's object is handed back as it is, and development says so** (Brian's ruling,
 * 2026-11-06). A property locked with defineProperty (non-writable, non-configurable) must be returned exactly, so the
 * object in it is not a store: production is unchanged (the object as it is), development reports `readonly-slot` once
 * per object, naming the key. CONTROL: a frozen parent, read as it is on purpose, reports nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, isProduction } from './dist.mjs';

const { createStore } = await load('core');
const said = (run) => {
  const lines = [];
  const error = console.error;
  console.error = (line) => lines.push(String(line));
  try { run(); } finally { console.error = error; }
  return lines;
};

test('a locked object slot is read as it is; development names the key, once', () => {
  const raw = {};
  const inner = { x: 1 };
  Object.defineProperty(raw, 'slot', { value: inner, writable: false, configurable: false, enumerable: true });
  const s = createStore(raw);
  const lines = said(() => { assert.equal(s.slot, inner); assert.equal(s.slot.x, 1); });
  const named = lines.filter((line) => line.includes('readonly-slot'));
  assert.equal(named.length, isProduction ? 0 : 1, 'once, in development only');
  if (!isProduction) assert.ok(named[0].includes('slot'), 'it names the key');
});

test('CONTROL: a frozen parent is read as it is and reports nothing', () => {
  const s = createStore(Object.freeze({ slot: { x: 1 } }));
  const lines = said(() => { void s.slot.x; });
  assert.equal(lines.filter((line) => line.includes('readonly-slot')).length, 0);
});
