/**
 * `connectInserts` — the call that makes two standalone bundles share one registry.
 *
 * Each `.min.js` inlines its own copy of `@verajs/inserts`, so in CDN mode `@verajs/core` and
 * `@verajs/router` arrive carrying two registries and this points one at the other. That is
 * intentional and is the price of the modules being genuinely independent of core.
 *
 * It used to **replace** the registry, which made the call order load-bearing: a `setRenderer` that
 * ran first became unreachable, silently, because nothing throws and the callback simply lands in a
 * map nobody reads afterwards. An app that rendered nothing, from two lines in the wrong order, with
 * no indication why. Registrations are now replayed into the new registry at their original
 * priorities, so both orders reach the same state and there is no rule left to know.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distUrl } from './dist.mjs';

/** A fresh copy per call, exactly as a separate bundle would carry. */
let seq = 0;
const copy = () => import(distUrl('inserts', `?connect=${seq++}`));

test('both call orders reach the same state', async () => {
  const [a, b] = [await copy(), await copy()];
  a.wire({ on: 'error', fn: () => 'E', priority: 10 });
  a.wire({ on: 'render', fn: () => 'R', priority: 50 });
  a.connectInserts(b.inserts);

  const [c, d] = [await copy(), await copy()];
  c.connectInserts(d.inserts);
  c.wire({ on: 'error', fn: () => 'E', priority: 10 });
  c.wire({ on: 'render', fn: () => 'R', priority: 50 });

  const shape = (map) => [...map].map(([name, chain]) => `${name}:${chain.length}`).sort();
  assert.deepEqual(shape(b.inserts), shape(d.inserts));
  assert.deepEqual(shape(b.inserts), ['error:1', 'render:1']);
});

test('a registration made before connecting survives', async () => {
  const [a, b] = [await copy(), await copy()];
  a.wire({ on: 'render', fn: () => 'kept', priority: 50 });
  a.connectInserts(b.inserts);
  assert.equal(b.inserts.get('render')?.length, 1, 'replayed into the shared registry');
  assert.equal(b.inserts.get('render')[0](), 'kept');
});

test('priorities survive the replay, in order', async () => {
  const [a, b] = [await copy(), await copy()];
  a.wire({ on: 'render', fn: () => 'low', priority: 10 });
  a.wire({ on: 'render', fn: () => 'high', priority: 90 });
  a.wire({ on: 'render', fn: () => 'mid', priority: 50 });
  a.connectInserts(b.inserts);
  assert.deepEqual(b.inserts.get('render').map((fn) => fn()), ['low', 'mid', 'high']);
});

test('a replayed entry replaces an existing one at the same priority', async () => {
  /** Exactly what a direct `insert` at a taken priority does — this is how setRenderer swaps. */
  const [a, b] = [await copy(), await copy()];
  b.wire({ on: 'render', fn: () => 'target', priority: 50 });
  a.wire({ on: 'render', fn: () => 'replayed', priority: 50 });
  a.connectInserts(b.inserts);
  assert.deepEqual(b.inserts.get('render').map((fn) => fn()), ['replayed'], 'one entry, not two');
});

test('connecting a registry to itself changes nothing', async () => {
  /** The bundler case: both specifiers resolve to one module, so the call is a genuine no-op and
   *  must not replay a chain into itself and duplicate it. */
  const a = await copy();
  a.wire({ on: 'render', fn: () => 'once', priority: 50 });
  a.connectInserts(a.inserts);
  assert.equal(a.inserts.get('render').length, 1);
});

test('connecting an empty registry carries nothing across', async () => {
  const [a, b] = [await copy(), await copy()];
  b.wire({ on: 'render', fn: () => 'target', priority: 50 });
  a.connectInserts(b.inserts);
  assert.equal(b.inserts.get('render').length, 1, 'the target is untouched');
});
