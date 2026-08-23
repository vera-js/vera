/**
 * The CDN consumption mode: two standalone bundles on one page, each carrying its own inlined copy
 * of `@verajs/inserts`, reconnected with `connectInserts`.
 *
 * This condition **only exists in the production build.** `dist/development/*.js` keeps
 * `@verajs/inserts` external, so core and router resolve to one shared module and the whole problem
 * is absent; `dist/*.min.js` inlines it, so they hold two registries. The development pass below is
 * a control — it should pass trivially. The production pass is the one that means something.
 *
 * What it guards, specifically: `_p` on an insert chain carries the priority order and is read by
 * every inlined copy. It is a cross-bundle contract. A property-mangling regex added to core or
 * router would rename it in one bundle and not the other — priorities would be ignored and
 * same-priority replacement would duplicate instead of replace. No development test can see that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

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

test('the two bundles really are separate copies in production', () => {
  /** If this ever stops being true in production, `connectInserts` has become dead code. */
  if (isProduction) {
    assert.notEqual(core.inserts, router.inserts, 'each production bundle inlines its own registry');
  } else {
    assert.equal(core.inserts, router.inserts, 'development keeps one shared module');
  }
});

test('connectInserts joins them into one registry', () => {
  router.connectInserts(core.inserts);
  assert.equal(router.inserts ?? core.inserts, core.inserts);

  /** Registering through either bundle must land in the same chain. */
  const seen = [];
  core.insert('render', () => seen.push('core@10'), 10);
  router.insert('render', () => seen.push('router@75'), 75);
  const chain = core.inserts.get('render');
  chain.forEach((cb) => cb('', app));

  assert.ok(seen.includes('core@10'), 'core registration ran');
  assert.ok(seen.includes('router@75'), 'router registration ran through the shared registry');
});

test('priority order holds across the bundle boundary', () => {
  router.connectInserts(core.inserts);
  const chain = core.inserts.get('render');
  chain.length = 0;
  if (chain._p) chain._p.length = 0;

  const seen = [];
  router.insert('render', () => seen.push(75), 75);
  core.insert('render', () => seen.push(10), 10);
  router.insert('render', () => seen.push(50), 50);
  core.inserts.get('render').forEach((cb) => cb('', app));

  /**
   * This is the assertion that a mangled `_p` breaks. Each bundle reads the order array the other
   * one wrote; if they disagree about the property name, each sees an empty order and appends.
   */
  assert.deepEqual(seen, [10, 50, 75], 'lower priority runs first, across both bundles');
});

test('same-priority registration replaces rather than duplicates, across bundles', () => {
  router.connectInserts(core.inserts);
  const chain = core.inserts.get('render');
  chain.length = 0;
  if (chain._p) chain._p.length = 0;

  core.insert('render', () => {}, 50);
  router.insert('render', () => {}, 50);
  assert.equal(core.inserts.get('render').length, 1, 'one entry at priority 50, not two');
});

// ── the rule for extension packages ─────────────────────────────────────────

test('registering through a foreign @verajs/inserts copy never reaches core', async () => {
  /**
   * A cache-busting query, so this is a genuinely separate copy however the specifier resolves.
   * Loading it plainly used to work by accident: without `--conditions development` core's bare
   * `@verajs/inserts` fell through to the *production* build while this line loaded the development
   * one, so they differed for the wrong reason. Once the suite resolved the way a development
   * consumer does, they became the same module and this assertion inverted.
   */
  const standalone = await load('inserts', '?foreign');
  assert.notEqual(standalone.inserts, core.inserts, 'a separately loaded registry is its own map');

  const before = core.inserts.get('init')?.length ?? 0;
  standalone.insert('init', () => {}, 90);

  /**
   * The trap, in executable form. Whether a second copy exists at all depends on the build *and* on
   * how the specifier resolved, which is exactly what makes it treacherous — so this forces one. `@verajs/styles` was first written to register through its own copy: it passed
   * every development test and did nothing whatsoever in a production build.
   *
   * Nothing throws. The registration simply lands somewhere core never looks.
   */
  assert.equal(core.inserts.get('init')?.length ?? 0, before, 'core cannot see a foreign registry');
});

test('registering through core.insert reaches core in every build', () => {
  const before = core.inserts.get('init')?.length ?? 0;
  core.insert('init', () => {}, 91);
  assert.equal(core.inserts.get('init').length, before + 1, 'core’s own insert always lands');
});
