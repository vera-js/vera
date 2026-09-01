/**
 * The CDN consumption mode: two standalone bundles on one page.
 *
 * This file used to guard a hazard that no longer exists. Each production `.min.js` inlines its own
 * copy of `@verajs/inserts`, so core and the router held **two registries**; `connectInserts`
 * reconnected them, `_p` was a cross-bundle contract a mangling regex could silently break, and the
 * rule "take `insert` from the package that owns the extension point" existed because picking the
 * wrong copy wrote to a map nobody read — in production only.
 *
 * The router imports no registry now. It is handed one (`router`, which `wire([…])`
 * applies) or handed a renderer directly (`setRouterRenderer`, the no-core path). So there is no
 * second registry to reconcile and no wrong one to pick, and what this file guards is the *absence*
 * of the hazard rather than the repair for it.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs). The production pass is still
 * the one that means something: it is the only place the two bundles are genuinely separate code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>');
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.window = dom.window;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;

const core = await load('core');
const router = await load('router');
const app = document.getElementById('app');

test('the router carries no registry of its own', () => {
  assert.equal(router.inserts, undefined, 'nothing to reconcile means nothing to get wrong');
  assert.equal(typeof router.router, 'function', 'it is handed one instead');
  assert.equal(typeof router.setRouterRenderer, 'function', 'or handed a renderer, with no core at all');
});

test('a connector wires the router to the registry core owns', () => {
  core.wire([router.router]);

  const seen = [];
  core.wire({ on: 'render', fn: (template, element) => seen.push(`core@10:${element.id}`), priority: 10 });
  core.inserts.get('render').forEach((cb) => cb('', app));

  assert.deepEqual(seen, ['core@10:app'], 'one registry, and the router reads it');
});

/**
 * The registration form itself: a **connector** (a function handed the registry, which is how a
 * package that imports nothing gets wired), a **descriptor** naming its chain, and anything a user
 * writes inline — all in one call, priority-ordered.
 */
test('wire([…]) takes connectors, descriptors and whatever a user writes', () => {
  const order = [];
  let connected = false;

  core.wire([
    (registry) => (connected = registry === core.inserts),
    { on: 'init', fn: () => order.push('descriptor@50'), priority: 50 },
    { on: 'init', fn: () => order.push('user@10'), priority: 10 },
  ]);

  core.inserts.get('init').forEach((fn) => fn(app));

  assert.equal(connected, true, 'a connector receives the registry');
  assert.deepEqual(order, ['user@10', 'descriptor@50'], 'and priority still orders the chain');
});

/**
 * `_p` carries the priority order on a chain. It is no longer a *cross-bundle* contract — only core
 * writes and reads it now — but it is still a contract between this package's own inlined copies,
 * and a mangling regex added to core would still break it. Cheap to keep holding.
 */
test('the priority order survives minification', () => {
  const chain = core.inserts.get('init');
  assert.ok(Array.isArray(chain._p), '`_p` must not be mangled');
  assert.deepEqual(chain._p, [...chain._p].sort((a, b) => a - b), 'and stays sorted');
});
