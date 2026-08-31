/**
 * An insert wired *after* the thing that reads it has already cached the chain.
 *
 * `createProxy` does not call `inserts.get('proxy-handler')` per property read — that would be a map
 * lookup on the hottest path in the framework. It caches the chain and re-reads it when `revision`
 * changes, a live binding every registration bumps.
 *
 * `revision` is the **least-referenced public export in the framework**: one test file, against
 * sixteen for `hold`. And the case it exists for is ordinary import order — an app whose entry wires a
 * module after some other module has already created a store, which is decided by the order of
 * `import` statements and nothing else.
 *
 * The failure it prevents is silent in the worst way: the handler is registered, `inserts.get` would
 * return it, and it simply never runs, because the reader is still holding the array it read first.
 *
 * ## What `revision` is actually load-bearing for
 *
 * `register` **splices the chain in place**, so a reader holding the array already sees entries added
 * to it. Measured: replacing the guard with `proxyHandlers === undefined` passes every case here.
 * `revision` is what covers the `undefined -> array` transition — the first registration for a point
 * nobody had wired — and freezing it fails three of the four below.
 *
 * ## The half that is easy to get wrong
 *
 * Picking up the handler for **stores created afterwards** is the easy half — a fresh read would do
 * it. The one that needs the invalidation is a store that **already existed**: its reads must run the
 * new handler too, which they only do if the cache is dropped rather than merely bypassed for new
 * objects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame',
])
  globalThis[key] = dom.window[key];

const core = await load('core');

/** Created and read before anything is wired, so its chain is cached empty. */
const existing = core.createStore({ n: 1 });
const seen = [];

test('a store read before any handler is wired runs none', () => {
  void existing.n;
  assert.deepEqual(seen, [], 'nothing is registered yet — the control');
});

test('a proxy-handler wired afterwards runs for a store made later', () => {
  core.wire({
    on: 'proxy-handler',
    fn: (object, prop, value) => { seen.push(prop); return value; },
    priority: 40,
  });

  const later = core.createStore({ m: 2 });
  seen.length = 0;
  void later.m;
  assert.deepEqual(seen, ['m'], 'the handler was picked up rather than missed');
});

/** The half that needs the cache dropped rather than merely bypassed for new objects. */
test('and for the store that already existed before it was wired', () => {
  seen.length = 0;
  void existing.n;
  assert.deepEqual(seen, ['n'], 'the cached chain was invalidated, not just skipped for new stores');
});

test('and a second handler added later joins the chain in priority order', () => {
  core.wire({
    on: 'proxy-handler',
    fn: (object, prop, value) => { seen.push(`second:${prop}`); return value; },
    priority: 41,
  });

  const third = core.createStore({ z: 3 });
  seen.length = 0;
  void third.z;
  assert.deepEqual(seen, ['z', 'second:z'], 'both run, lower priority first');
});
