/**
 * **Wiring a store module through one copy of core re-decides every copy's stores** (2026-11-11). In development the
 * copies on a page share one `@verajs/inserts` registry (it stays external), so a module wired through copy 1 is in
 * copy 2's registry too, but only copy 1 re-decided its types: copy 2's store made before the wire kept its old
 * decision. Each copy now
 * registers its own re-decision on the shared registry (`$rs`), and `wire` calls every one of them: a push, nothing per
 * read. In production each bundle inlines its own registry, so a copy wires only itself; the row checks the single
 * copy there. The module here wraps records with a spy over the handler it is handed. CONTROL: copy 1's own store
 * takes it either way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, isProduction } from './dist.mjs';

const a = await load('core');
/** A 'store' module that claims records with a spy over the handler it is handed: a read logs its key. */
const seen = [];
const spy = { on: 'store', priority: 60, fn: (type, handler) => (type === 'object' && handler ? { ...handler, get: (t, p, r) => { seen.push(p); return handler.get(t, p, r); } } : handler) };

test('a store module wired through copy 1 re-decides copy 2\'s existing stores (development: one shared registry)', { skip: isProduction && 'production: each bundle has its own registry' }, async () => {
  const b = await import(`../packages/core/dist/development/vera.js?copy=${Date.now()}`);
  assert.equal(a.inserts, b.inserts, 'CONTROL: the two copies share one registry');
  assert.notEqual(a.createStore, b.createStore, 'CONTROL: two copies of core');
  const one = a.createStore({ first: 1 });
  const two = b.createStore({ second: 2 });
  a.wire([spy]);
  void one.first;
  void two.second;
  assert.ok(seen.includes('first'), 'CONTROL: copy 1 re-decided its own store');
  assert.ok(seen.includes('second'), 'copy 2\'s store made before the wire took the module too');
});

test('production: one bundle, its own registry, a late wire reaches its existing store', { skip: !isProduction && 'development: covered above' }, () => {
  const one = a.createStore({ first: 1 });
  a.wire([spy]);
  void one.first;
  assert.ok(seen.includes('first'));
});
