/**
 * **A record written into a store is stored as given: its getters never run on the write** (D5, Brian 2026-11-08). A
 * throwing getter does not throw, a counting one counts nothing, and the stored record keeps its accessor. An ARRAY
 * written into a store is still scanned for the store's proxies (a one-level raw copy), so a getter defined on an array
 * INDEX runs: a documented limit, pinned here so a change to it is noticed. CONTROL: a record holding a store child
 * reads that child back through the store as the same store.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore } = await load('core');

test('a written record\'s getters never run, and the stored record keeps its accessor', () => {
  const s = createStore({ row: null });
  let reads = 0;
  const row = { id: 1, get bad() { throw new RangeError('getter'); }, get counted() { reads++; return 1; } };
  assert.doesNotThrow(() => { s.row = row; });
  assert.equal(reads, 0, 'no getter ran on the write');
  assert.equal(s.row.id, 1);
  assert.equal(typeof Object.getOwnPropertyDescriptor(row, 'bad').get, 'function', 'the record keeps its accessor');
});

test('A KNOWN LIMIT, pinned: a getter defined on an ARRAY index runs when that array is written into a store', () => {
  const s = createStore({ list: null });
  let reads = 0;
  const list = [1, 2];
  Object.defineProperty(list, 0, { get() { reads++; return 1; }, enumerable: true, configurable: true });
  s.list = list;
  assert.equal(reads, 1, 'the array scan read the index once (change this row only together with the documentation)');
});

test('CONTROL: a record holding a store child reads it back through the store as the same store', () => {
  const s = createStore({ row: null, pool: [{ v: 7 }] });
  const child = s.pool[0];
  s.row = { id: 1, child };
  assert.equal(s.row.child, child);
  assert.equal(s.row.child.v, 7);
});
