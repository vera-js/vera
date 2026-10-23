/**
 * **A built-in that writes several slots of a store array notifies ONCE, after it finishes** (2026-10-18). Through the
 * proxy, `splice` / `shift` / `sort` … wrote index by index, and a hook that runs on each write (a raw core's raw hook (internal),
 * a `'sync'` effect) ran between those writes: `splice(4, 1)` on 10 rows ran it 7 times, 6 of them on a half-shifted
 * array (a row twice, or a hole). Now the method runs on the raw array and every subscriber is told once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createStore } = await load('core');
/** The raw hook primitive is core-internal since `effect` (2026-10-22): reached through core's own hand-off, `$s[2]`. */
const createHook = (await load('core')).inserts.$s[2];

const rowsOf = (n = 10) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
/** A RAW hook reading every row: it runs inside each notification it hears, so its run count IS the notification count. */
const watch = (state) => {
  const seen = [];
  const owner = { _$g$: 1, _$x$: false, localName: 'probe', isConnected: true };
  createHook({ priority: 50, element: owner, callback: () => { const ids = []; for (let i = 0; i < state.rows.length; i++) ids.push(state.rows[i]?.id); seen.push(ids); } })();
  seen.length = 0;
  return seen;
};

const OPS = {
  'splice(4, 1)': (a) => a.splice(4, 1),
  'splice(2, 0, x)': (a) => a.splice(2, 0, { id: 100 }),
  'unshift(x)': (a) => a.unshift({ id: 100 }),
  'shift()': (a) => a.shift(),
  'pop()': (a) => a.pop(),
  'push(a, b)': (a) => a.push({ id: 100 }, { id: 101 }),
  'reverse()': (a) => a.reverse(),
  'sort(desc)': (a) => a.sort((x, y) => y.id - x.id),
  'fill(x, 3, 5)': (a) => a.fill({ id: 0 }, 3, 5),
  'copyWithin(0, 5)': (a) => a.copyWithin(0, 5),
};

test('CONTROL: a single field write is heard once', () => {
  const state = createStore({ rows: rowsOf() });
  const seen = watch(state);
  state.rows[2].id = 99;
  assert.equal(seen.length, 1);
});

for (const [name, op] of Object.entries(OPS))
  test(`${name}: one notification, and the hook sees only the FINISHED array (the same as on a plain array)`, () => {
    const state = createStore({ rows: rowsOf() });
    const seen = watch(state);
    const plain = rowsOf();
    op(state.rows);
    op(plain);
    assert.equal(seen.length, 1, `${name} notified ${seen.length} times`);
    assert.deepEqual(seen[0], plain.map((r) => r.id), `${name}: what the hook saw`);
  });

test('what a mutator hands back goes through the store, as a read would', () => {
  const state = createStore({ rows: rowsOf() });
  const last = state.rows[9];
  assert.equal(state.rows.pop(), last, 'pop returns the same proxy a read returned');
  const third = state.rows[2];
  assert.equal(state.rows.splice(2, 1)[0], third, 'splice returns proxies');
  assert.equal(state.rows.sort((x, y) => x.id - y.id), state.rows, 'sort returns the store array itself');
  assert.equal(state.rows.reverse(), state.rows, 'reverse too');
});

test('the shape is told only when the length moved: an enumeration reader skips a reorder and hears a push', () => {
  const state = createStore({ rows: rowsOf() });
  let runs = 0;
  const owner = { _$g$: 1, _$x$: false, localName: 'probe', isConnected: true };
  createHook({ priority: 50, element: owner, callback: () => { runs++; Object.keys(state.rows); } })();
  runs = 0;
  state.rows.reverse();
  assert.equal(runs, 0, 'reverse changed no key');
  state.rows.push({ id: 100 });
  assert.equal(runs, 1, 'push added one');
});

test('a mutator borrowed onto another array writes THAT array, and the store hears nothing', () => {
  const state = createStore({ rows: rowsOf() });
  const seen = watch(state);
  const other = [];
  state.rows.push.call(other, { id: 100 });
  assert.equal(other.length, 1);
  assert.equal(state.rows.length, 10);
  assert.equal(seen.length, 0);
});

test("sort's comparator is handed what a read hands back: the store's proxies", () => {
  const state = createStore({ rows: rowsOf() });
  const reads = new Set([state.rows[0], state.rows[1]]);
  let matched = 0;
  state.rows.sort((a, b) => { if (reads.has(a)) matched++; return b.id - a.id; });
  assert.ok(matched > 0, 'the comparator saw the same objects a read returns');
  assert.equal(state.rows[0].id, 10);
});
