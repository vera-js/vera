/**
 * `connectInserts` ordering — the CDN mode's sharpest edge.
 *
 * Each standalone `.min.js` inlines its own copy of `@verajs/inserts`, so two bundles arrive with
 * two registries and `connectInserts` points one at the other. It **replaces** rather than merges,
 * which makes the call order load-bearing: anything registered first becomes unreachable, silently,
 * because nothing throws and the callback simply lands in a map nobody reads afterwards.
 *
 * Merging instead was rejected on weight — this package is inlined into core, the renderer and the
 * router, so a byte here is paid three times in the packages least able to afford it. So the
 * failure is made loud in development instead, and pinned here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distUrl, isProduction } from './dist.mjs';

/** A fresh copy per call, exactly as a separate bundle would carry. */
const copy = (id) => import(distUrl('inserts', `?connect=${id}`));

test('registering before connecting loses the registration', async () => {
  const a = await copy('a1');
  const b = await copy('b1');
  a.insert('error', () => 'from a', 10);
  assert.equal(a.inserts.get('error')?.length, 1);

  a.connectInserts(b.inserts);
  assert.equal(a.inserts.get('error'), undefined, 'the earlier registration is unreachable');
  assert.equal(b.inserts.get('error'), undefined, 'and was not carried across');
});

test('connecting first is the working order', async () => {
  const c = await copy('c1');
  const d = await copy('d1');
  c.connectInserts(d.inserts);
  c.insert('error', () => 'from c', 10);
  assert.equal(d.inserts.get('error')?.length, 1, 'the registration lands in the shared registry');
});

test('development warns about the losing order; production says nothing', async () => {
  const a = await copy('a2');
  const b = await copy('b2');
  a.insert('render', () => {}, 50);

  const said = [];
  const realWarn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    a.connectInserts(b.inserts);
  } finally {
    console.warn = realWarn;
  }

  if (isProduction) {
    assert.deepEqual(said, [], 'the check is __DEV__-only and folds away');
  } else {
    assert.equal(said.length, 1);
    assert.match(said[0], /connectInserts/);
    assert.match(said[0], /render/, 'it names which chains were lost');
    assert.match(said[0], /Call connectInserts\(\) first/, 'and how to fix it');
  }
});

test('connecting a registry to itself is not reported', async () => {
  /** The bundler case: both specifiers resolve to one module, so the call is a genuine no-op. */
  const a = await copy('a3');
  a.insert('render', () => {}, 50);
  const said = [];
  const realWarn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    a.connectInserts(a.inserts);
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(said, [], 'no warning when nothing is actually replaced');
  assert.equal(a.inserts.get('render')?.length, 1, 'and nothing is lost');
});

test('connecting into an empty registry is silent', async () => {
  const a = await copy('a4');
  const b = await copy('b4');
  const said = [];
  const realWarn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    a.connectInserts(b.inserts);
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(said, [], 'the correct order must not warn');
});
