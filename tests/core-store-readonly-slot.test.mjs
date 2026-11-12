/**
 * **A locked slot: handed back as it is when the store saw the lock; the engine refuses it otherwise** (Brian's
 * ruling, 2026-11-12, superseding 2026-11-06's "every locked slot handed back"). A property locked with defineProperty
 * (non-writable, non-configurable) must read back exactly as it is, so a store cannot hand a store from it. Checking
 * every slot on every first read cost 13-16% of that read on V8, SpiderMonkey and JSC (measured), for a rare case.
 * Now the store watches for locks made THROUGH it (free until the first): such a slot is handed back as it is
 * (development: `readonly-slot`, not reactive). A slot locked BEFORE its object went into a store is not seen: the
 * engine refuses the read with its own TypeError, in both builds, and development names the key and the cure first
 * (`readonly-slot-unseen`). CONTROL: a frozen parent, read as it is on purpose, says nothing.
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
const lock = (obj, key, value) => Object.defineProperty(obj, key, { value, writable: false, configurable: false, enumerable: true });

test('a slot locked BEFORE its object went into a store: the read throws in both builds; development names it first', () => {
  const raw = {};
  lock(raw, 'slot', { x: 1 });
  const s = createStore(raw);
  const lines = said(() => assert.throws(() => s.slot, TypeError));
  const named = lines.filter((line) => line.includes('readonly-slot-unseen'));
  assert.equal(named.length, isProduction ? 0 : 1, 'development names it');
  if (!isProduction) assert.ok(named[0].includes('slot'), 'naming the key');
});

test('a slot locked THROUGH the store is handed back as it is; development says it is not reactive, once', () => {
  const inner = { x: 1 };
  const s = createStore({ holder: {} });
  lock(s.holder, 'slot', inner);
  const lines = said(() => { assert.equal(s.holder.slot, inner); assert.equal(s.holder.slot.x, 1); });
  const named = lines.filter((line) => line.includes('readonly-slot') && !line.includes('readonly-slot-unseen'));
  assert.equal(named.length, isProduction ? 0 : 1);
});

test('CONTROL: a frozen parent is read as it is and says nothing', () => {
  const inner = { x: 1 };
  const s = createStore({ f: Object.freeze({ inner }) });
  const lines = said(() => assert.equal(s.f.inner, inner));
  assert.equal(lines.filter((line) => line.includes('readonly-slot')).length, 0);
});
