/**
 * **Mounting the app somewhere other than the origin's root.**
 *
 * A site served at `/app/` writes its routes as `/users`, not `/app/users` — the base is a
 * deployment fact, not part of the route table. So the router works entirely in ROUTE SPACE and the
 * base is added or stripped only where a path crosses to or from the browser. That boundary is the
 * whole feature: four reads (initial route, `popstate`, `resolve`, link clicks), one write
 * (`updateHistory`) and one comparison (`updateActiveLink`, which matches an `href` carrying the
 * base against a path that does not).
 *
 * The comparison is the one that fails silently, so it gets its own test. An `href` has to carry the
 * base or the browser cannot follow it, while the router's path has it stripped — a nav bar under a
 * base would simply never highlight, with no error anywhere.
 *
 * The base comes from the `<base>` ELEMENT, or from `setBasePath()` which overrides it.
 *
 * **Why not `document.baseURI`** — the obvious spelling, and wrong: with no `<base>` element it is
 * the document's own URL, whose pathname is the CURRENT ROUTE. Deriving a mount point from it made
 * a navigation from `/start` to `/fast` write `/start/fast` to the address bar while every route
 * still matched, because route space was right the whole time and only the URL was wrong. That is
 * pinned below rather than left as a comment, because it is the mistake anyone would make twice.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/app/start' });
const { window } = dom;
for (const key of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent']) globalThis[key] = window[key];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

const { initRouter, navigate, setBasePath } = await load('router');
const doc = window.document;

/** A fresh host + router per test, so no test inherits another's current route. */
const mount = (routes) => {
  const host = doc.createElement('div');
  const view = doc.createElement('main');
  host.appendChild(view);
  doc.body.appendChild(host);
  const router = initRouter(host, { view, focusView: false, handleInitial: false });
  router.addRoutes(routes);
  return { host, view, router };
};
/**
 * Routes record which one MATCHED rather than rendering text: asserting rendered output would need
 * a renderer wired, and what this file is about is which route the path resolved to.
 */
let hit = null;
const ROUTES = [
  { path: '/', component: () => { hit = 'home'; return ''; } },
  { path: '/users', component: () => { hit = 'users'; return ''; } },
  { path: '/users/:id', component: () => { hit = 'one user'; return ''; } },
];

/**
 * Each test resets to `/` first. Routers accumulate across this file and `navigate` to the path the
 * router is ALREADY on is a no-op, so a test that happens to follow one ending on the same route
 * sees no component run at all and reads as "nothing matched" — a silence that looks like a routing
 * failure and is really test ordering.
 */
const reset = async () => {
  await navigate('/', 'replace');
  await tick();
  hit = null;
};

test('with no base, paths pass through untouched', async () => {
  setBasePath(null);
  mount(ROUTES);
  hit = null;
  await navigate('/users', 'navigate');
  await tick();
  assert.equal(window.location.pathname, '/users', 'the URL is the route path itself');
  assert.equal(hit, 'users');
});

/**
 * The regression this feature was built wrong once by: `document.baseURI` with no `<base>` present
 * is the current page, so a base derived from it grows by one segment per navigation.
 */
test('CONTROL: a base is not derived from the current page URL', async () => {
  setBasePath(null);
  assert.equal(doc.querySelector('base'), null, 'no <base> element exists for this test');
  mount(ROUTES);
  hit = null;
  await navigate('/users', 'navigate');
  await tick();
  await navigate('/users/5', 'navigate');
  await tick();
  assert.equal(window.location.pathname, '/users/5',
    'the second navigation is not nested under the first — which is what baseURI produced');
  assert.equal(hit, 'one user');
});

test('setBasePath adds the base to the URL and strips it from matching', async () => {
  setBasePath('/app');
  mount(ROUTES);
  hit = null;
  await navigate('/users', 'navigate');
  await tick();
  assert.equal(window.location.pathname, '/app/users', 'the browser sees the mounted path');
  assert.equal(hit, 'users', 'and the route table, written without the base, still matches');

  await navigate('/', 'navigate');
  await tick();
  assert.equal(window.location.pathname, '/app', "the app's own root is the base itself, with no trailing slash");
  assert.equal(hit, 'home');
  setBasePath(null);
});

/**
 * The silent one. `href` carries the base because the browser has to be able to follow it; the
 * router's current path does not. Comparing them raw means a nav bar that never highlights.
 */
test('active-link marking compares across the base', async () => {
  setBasePath('/app');
  const { host } = mount(ROUTES);
  const link = doc.createElement('a');
  link.setAttribute('route', '');
  link.setAttribute('href', '/app/users');
  host.appendChild(link);

  await navigate('/users', 'navigate');
  await tick();
  assert.ok(link.classList.contains('active'), 'the link whose href includes the base is marked active');
  assert.equal(link.getAttribute('aria-current'), 'page');
  setBasePath(null);
});

/**
 * A path that merely shares a PREFIX with the base is not under it. Stripping by string length
 * alone turns `/application` into `lication`, which then matches nothing and looks like a routing
 * bug rather than a stripping bug.
 */
test('a path that only shares a prefix with the base is left alone', async () => {
  setBasePath('/app');
  mount([...ROUTES, { path: '/application', component: () => { hit = 'not ours'; return ''; } }]);
  await reset();
  await navigate('/users', 'navigate');
  await tick();
  assert.equal(window.location.pathname, '/app/users', 'CONTROL: the base is in effect');
  assert.equal(hit, 'users', 'and the prefix-sharing route was not what matched');
  setBasePath(null);
});

/**
 * **A relative href is resolved before it is compared.** Written as-is, `href="hello"` is matched
 * against a path of `/hello` — two different strings for the same destination — so a nav built with
 * relative links never highlighted at all. That predates the base feature and was invisible only
 * because every example here wrote absolute hrefs; a base makes relative links the natural spelling,
 * which is how it surfaced.
 *
 * Resolution goes through `document.baseURI`, the same source the link-click handler uses, so a link
 * is judged active by exactly the URL that clicking it would reach.
 */
test('a RELATIVE href is marked active — it is resolved, not compared as written', async () => {
  setBasePath('/app');
  const { host } = mount(ROUTES);
  await reset();

  const relative = doc.createElement('a');
  relative.setAttribute('route', '');
  relative.setAttribute('href', 'users');
  const foreign = doc.createElement('a');
  foreign.setAttribute('route', '');
  foreign.setAttribute('href', 'https://example.com/users');
  host.append(relative, foreign);

  await navigate('/users', 'navigate');
  await tick();
  assert.ok(relative.classList.contains('active'), 'the relative link resolves to the current route');
  assert.ok(!foreign.classList.contains('active'),
    'and another origin never matches, though its pathname would collide');
  setBasePath(null);
});

test('the <base> element supplies the base when nothing is set explicitly', async () => {
  setBasePath(null);
  const base = doc.createElement('base');
  base.setAttribute('href', '/app/');
  doc.head.appendChild(base);

  mount(ROUTES);
  await reset();
  await navigate('/users', 'navigate');
  await tick();
  assert.equal(window.location.pathname, '/app/users', 'read from the document, with no API call at all');
  assert.equal(hit, 'users');

  /** And the explicit setter wins over it, which is the whole reason the setter exists. */
  setBasePath('/other');
  await reset();
  await navigate('/users', 'navigate');
  await tick();
  assert.equal(window.location.pathname, '/other/users', 'setBasePath overrides the document');

  setBasePath(null);
  base.remove();
});
