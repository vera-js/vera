/**
 * **The cross-surface battery: every router feature that could interact with the base, run under
 * one.**
 *
 * The base-path work touched the URL boundary, and the suites it grew — `router-base-path`,
 * `router-gestures` — test the boundary itself. This file asks the other question: did any
 * FEATURE that rides through that boundary come apart? Hash navigation, hash-only changes,
 * redirects in both forms, guard snapshots, multi-router fan-out, cold loads with fragments, and
 * the named-navigation failure contract — each is one row, all under `setBasePath('/app')`,
 * because "works at the origin root" was already covered and "works mounted" was assumed for all
 * of them.
 *
 * One assumption was wrong, found by the battery rather than by a user: `navigate({ name: 'typo' })`
 * RETURNED TRUE. `resolve` answers `''` for an unknown name, an empty string resolves to the
 * current page, and the same-path early return reported success — to the exact code the README
 * tells people to trust ("await navigate() and handle the failure"). The battery's row for it now
 * pins the contract: an unknown name moves nothing and claims nothing.
 *
 * Guard snapshots seeing ROUTE space (`/guarded`, never `/app/guarded`) is pinned here too — every
 * guard in every app would break on a mounted deploy if a base ever leaked into snapshots, and
 * nothing else asserted it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/app/docs' });
const { window } = dom;
for (const key of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent']) globalThis[key] = window[key];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

const { initRouter, navigate, currentRoute, setBasePath } = await load('router');
const doc = window.document;

setBasePath('/app');

let hit = null;
let guardSaw = null;
const host = doc.createElement('div');
const view = doc.createElement('main');
host.appendChild(view);
doc.body.appendChild(host);
const router = initRouter(host, { view, focusView: false, handleInitial: false });
router.addRoutes([
  { path: '/', component: () => { hit = 'home'; return ''; } },
  { path: '/docs', component: () => { hit = 'docs'; return ''; } },
  { path: '/old', redirect: '/docs', component: () => { hit = 'old'; return ''; } },
  { path: '/old-fn', redirect: () => '/docs', component: () => { hit = 'old-fn'; return ''; } },
  { path: '/guarded', beforeEnter: (params, to) => { guardSaw = to.path; return true; }, component: () => { hit = 'guarded'; return ''; } },
  { path: '/users/:id', name: 'user', component: () => { hit = 'user'; return ''; } },
]);

const go = async (target) => {
  hit = null;
  const routed = await navigate(target, 'navigate');
  await tick();
  return { hit, routed, url: window.location.pathname + window.location.search + window.location.hash };
};
const from = async (path) => {
  await navigate('/', 'replace');
  await tick();
  if (path !== '/') { await navigate(path, 'navigate'); await tick(); }
  hit = null;
};

test('a fragment rides through the base: path#hash navigates, mounted, fragment intact', async () => {
  await from('/');
  assert.deepEqual(await go('/docs#install'), { hit: 'docs', routed: true, url: '/app/docs#install' });
});

test('a hash-only change re-routes nothing and still updates the snapshot', async () => {
  await from('/docs');
  const result = await go('/docs#usage');
  assert.equal(result.hit, null, 'same path — no component re-ran, exactly as without a base');
  assert.equal(result.url, '/app/docs#usage');
  assert.equal(currentRoute().hash, '#usage', 'the page-wide snapshot heard about it');
});

test('query and fragment together survive the round trip', async () => {
  await from('/');
  assert.deepEqual(await go('/users/9?tab=a#deep'), { hit: 'user', routed: true, url: '/app/users/9?tab=a#deep' });
});

test('redirects land mounted, in both forms', async () => {
  await from('/');
  assert.deepEqual(await go('/old'), { hit: 'docs', routed: true, url: '/app/docs' },
    'a string redirect is a route-space path and comes out mounted');
  await from('/');
  assert.deepEqual(await go('/old-fn'), { hit: 'docs', routed: true, url: '/app/docs' },
    'and a function redirect the same');
});

test('a guard sees ROUTE space — the base never reaches a snapshot', async () => {
  await from('/');
  guardSaw = null;
  await go('/guarded');
  assert.equal(guardSaw, '/guarded',
    'every guard in every app would break on a mounted deploy if this ever carried the base');
});

/**
 * The row that failed when this battery first ran. An unknown name resolved to `''`, the empty
 * string resolved to the current page, and the same-path early return answered `true` — a reported
 * SUCCESS for a typo. `resolve` warns with the name in development; the return value is the
 * behavioural contract and holds in production too.
 */
test('an unknown route name moves nothing and does not claim success', async () => {
  await from('/docs');
  const before = window.location.pathname;
  const original = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = await navigate({ name: 'typo-name' }, 'navigate');
    await tick();
  } finally {
    console.warn = original;
  }
  assert.equal(window.location.pathname, before, 'the page did not move');
  assert.equal(result, false, 'and the promise says so, because the README tells people to await it');
});

test('two routers fan out one mounted navigation', async () => {
  let second = null;
  const host2 = doc.createElement('div');
  const view2 = doc.createElement('main');
  host2.appendChild(view2);
  doc.body.appendChild(host2);
  const router2 = initRouter(host2, { view: view2, focusView: false, handleInitial: false });
  router2.addRoutes([
    { path: '/', component: () => { second = 'home-2'; return ''; } },
    { path: '/docs', component: () => { second = 'docs-2'; return ''; } },
  ]);
  await from('/');
  second = null;
  const result = await go('/docs');
  assert.deepEqual({ one: result.hit, two: second, url: result.url }, { one: 'docs', two: 'docs-2', url: '/app/docs' });
  host2.remove();
});

/**
 * Cold load with a fragment, mounted: `handleInitial` reads the full location — pathname, search
 * AND hash — before any navigation exists, on its own code path. The document above starts at
 * `/app/docs`; this router starts at `/app/users/3?tab=x#pin` via replaceState, the way a served
 * page would arrive.
 */
test('a cold load with query and fragment routes, mounted, with everything intact', async () => {
  await from('/docs');
  window.history.replaceState(null, '', '/app/users/3?tab=x#pin');

  let landed = null;
  const host3 = doc.createElement('div');
  const view3 = doc.createElement('main');
  host3.appendChild(view3);
  doc.body.appendChild(host3);
  const router3 = initRouter(host3, { view: view3, focusView: false, handleInitial: true });
  router3.addRoutes([{ path: '/users/:id', component: (params) => { landed = params.id; return ''; } }]);
  await tick();
  await tick();

  assert.equal(landed, '3', 'the landing URL matched with the right param');
  assert.equal(window.location.pathname, '/app/users/3', 'and the visitor’s URL was left alone');
  assert.equal(currentRoute().query.get('tab'), 'x');
  assert.equal(currentRoute().hash, '#pin');
  host3.remove();
});
