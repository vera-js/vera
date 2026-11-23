/**
 * **What a static render refuses, exactly as the README says** (2026-11-23): a write to a store's own properties
 * throws ssr-static-write; a write below them is not caught, because a static read hands back a nested object as
 * itself (no proxy, no trap: that is the speed). The README states both; this pins both, so the sentence cannot drift
 * from the code in either direction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr';

const PAGE = new URL('./fixtures/ssr/static-nested-writer-ssr.js', import.meta.url);
const { shared } = await import(PAGE.href);
const REFUSED = /declared itself static/;

test("a write to a store's own property during a static render throws, and the store is unchanged", async () => {
  await assert.rejects(
    () => renderToString(PAGE, { tag: 'nested-top', static: true }),
    (error) => {
      assert.equal(error.constructor.name, 'TypeError');
      assert.match(error.message, REFUSED);
      return true;
    }
  );
  assert.equal(shared.top, 0);
});

test('a write below them is not caught: it renders, and the object keeps it (the documented boundary)', async () => {
  const before = [...shared.list];
  await renderToString(PAGE, { tag: 'nested-push', static: true });
  assert.deepEqual([...shared.list], [...before, 2]);
  shared.list.pop();
  const a = shared.o.a;
  await renderToString(PAGE, { tag: 'nested-assign', static: true });
  assert.equal(shared.o.a, 2);
  shared.o.a = a;
});
