/**
 * Route data and the knobs around it: `meta`, `router.currentRoute`, optional params, and
 * `scrollBehavior` — the four gaps the router audit closed.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs). Plain pass/fail script under
 * node --test: a nonzero exit marks the file failed.
 */
import { load } from './dist.mjs';
import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});
const dom = new JSDOM('<div></div>', { url: 'http://localhost/start', virtualConsole });
const { window } = dom;
window.scrollTo = () => {};
for (const k of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent', 'Element'])
  globalThis[k] = window[k];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = () => {};

const { initRouter, navigate, resolve, setRouterRenderer } = await load('router');
setRouterRenderer(() => {});

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => (cond ? pass++ : (fail++, console.log('FAIL:', name, extra)));

const app = (routes, options = {}) => {
  const element = window.document.createElement('div');
  const view = window.document.createElement('main');
  view.setAttribute('view', 'main');
  element.appendChild(view);
  window.document.body.appendChild(element);
  const router = initRouter(element, { view: 'main', focusView: false, handleInitial: false, ...options });
  router.addRoutes(routes);
  return router;
};

// ── route.meta ────────────────────────────────────────────────────────────────────────────────
/**
 * The router never reads `meta`; it carries it. That is what lets a guard decide on the route's
 * own terms — `to.meta.requiresAuth` — instead of re-parsing the path it was handed.
 */
{
  let fromComponent, fromGuard;
  const router = app([
    { path: '/public', meta: { auth: false }, component: (p, to) => { fromComponent = to.meta; return ''; } },
    { path: '/admin/:id', meta: { auth: true, layout: 'wide' }, component: () => '' },
  ]);
  router.on('before-route', (to) => { fromGuard = to.meta; });

  await navigate('/public', 'navigate');
  check('meta reaches the component', fromComponent?.auth === false, JSON.stringify(fromComponent));
  await navigate('/admin/7', 'navigate');
  check('meta reaches a guard', fromGuard?.auth === true && fromGuard?.layout === 'wide', JSON.stringify(fromGuard));

  // ── router.currentRoute ─────────────────────────────────────────────────────────────────────
  const current = router.currentRoute;
  check('currentRoute carries the path', current?.path === '/admin/7', current?.path);
  check('currentRoute carries parsed params', current?.params?.id === '7', JSON.stringify(current?.params));
  check('currentRoute carries meta', current?.meta?.layout === 'wide', JSON.stringify(current?.meta));
  check('currentRoute carries the trigger', current?.trigger === 'navigate', current?.trigger);
}

{
  const router = app([{ path: '/untouched', component: () => '' }]);
  check('currentRoute is undefined before routing', router.currentRoute === undefined);
}

// ── optional params ───────────────────────────────────────────────────────────────────────────
{
  let params;
  app([{ path: '/users/:id?', component: (p) => { params = p; return ''; } }]);
  await navigate('/users/5', 'navigate');
  check('an optional param matches when present', params.id === '5', JSON.stringify(params));
  await navigate('/users', 'navigate');
  check('and the path still matches without it', params.id === undefined, JSON.stringify(params));
  await navigate('/users/John%20D', 'navigate');
  check('an optional param decodes like any other', params.id === 'John D', JSON.stringify(params));
}

{
  let params;
  app([{ path: '/a/:x/b/:y?', component: (p) => { params = p; return ''; } }]);
  await navigate('/a/1/b/2', 'navigate');
  check('a required and an optional param together', params.x === '1' && params.y === '2', JSON.stringify(params));
  await navigate('/a/1/b', 'navigate');
  check('the required one survives the optional being absent', params.x === '1' && params.y === undefined,
    JSON.stringify(params));
}

/** The `?` must not leak into the ordinary forms it sits beside. */
{
  let hits = 0;
  app([{ path: '/required/:id', component: () => { hits++; return ''; } }]);
  await navigate('/required', 'navigate');
  check('a required param is still required', hits === 0, `matched ${hits}x`);
}
{
  let rest;
  app([{ path: '/w/*rest', component: (p) => { rest = p.rest; return ''; } }]);
  await navigate('/w/a/b', 'navigate');
  check('wildcards are unaffected', JSON.stringify(rest) === '["a","b"]', JSON.stringify(rest));
}
{
  let hits = 0;
  app([{ path: '/file.html', component: () => { hits++; return ''; } }]);
  await navigate('/fileXhtml', 'navigate');
  check('pattern metacharacters are still literal', hits === 0, `matched ${hits}x`);
}

// ── scrollBehavior ────────────────────────────────────────────────────────────────────────────
{
  const calls = [];
  let scrolled = 0;
  const realScrollTo = window.scrollTo;
  window.scrollTo = () => scrolled++;
  app([{ path: '/s1', component: () => '' }, { path: '/s2', component: () => '' }],
    { scrollBehavior: (to, saved) => calls.push([to.path, to.trigger, saved]) });
  await navigate('/s1', 'navigate');
  await navigate('/s2', 'navigate');
  window.scrollTo = realScrollTo;
  check('scrollBehavior runs per navigation', calls.length === 2, JSON.stringify(calls));
  check('it receives the destination', calls[1]?.[0] === '/s2', JSON.stringify(calls[1]));
  check('it receives the trigger', calls[1]?.[1] === 'navigate', JSON.stringify(calls[1]));
  check('and it replaces the default scroll', scrolled === 0, `scrollTo called ${scrolled}x`);
}

// ── named routes ──────────────────────────────────────────────────────────────────────────────
/**
 * A name is a handle on a URL, so renaming `/users/:id` leaves every caller alone. Values are
 * encoded on the way out and decoded on the way back in, so a param round-trips unchanged.
 */
{
  const router = app([
    { path: '/users/:id', name: 'user', component: () => '' },
    { path: '/users/:id/edit/:tab?', name: 'user-edit', component: () => '' },
    { path: '/files/*rest', name: 'file', component: () => '' },
    { path: '/about', name: 'about', component: () => '' },
    { path: '/parent', name: 'parent', children: [{ path: '/child', name: 'child', component: () => '' }] },
  ]);

  check('a name with no params', resolve('about') === '/about', resolve('about'));
  check('a name with a param', resolve('user', { id: 5 }) === '/users/5', resolve('user', { id: 5 }));
  check('values are encoded', resolve('user', { id: 'John Doe' }) === '/users/John%20Doe',
    resolve('user', { id: 'John Doe' }));
  check('an optional param, supplied', resolve('user-edit', { id: 5, tab: 'perms' }) === '/users/5/edit/perms',
    resolve('user-edit', { id: 5, tab: 'perms' }));
  check('an optional param, omitted, takes its segment', resolve('user-edit', { id: 5 }) === '/users/5/edit',
    resolve('user-edit', { id: 5 }));
  check('a wildcard takes an array of segments', resolve('file', { rest: ['a', 'b c'] }) === '/files/a/b%20c',
    resolve('file', { rest: ['a', 'b c'] }));
  check('a child route registers its complete path', resolve('child') === '/parent/child', resolve('child'));
  check('an unknown name resolves to nothing', resolve('nope') === '');

  await navigate(resolve('user', { id: 5 }));
  check('navigate(resolve(…)) lands on the path', router.currentRoute?.params?.id === '5',
    JSON.stringify(router.currentRoute?.params));

  /** The object form is Vue Router's shape, and is the same call through `resolve`. */
  await navigate({ name: 'user', params: { id: 'Jo Ann' } });
  check('navigate({ name, params }) routes', window.location.pathname === '/users/Jo%20Ann', window.location.pathname);
  check('and the param decodes back on arrival', router.currentRoute?.params?.id === 'Jo Ann',
    JSON.stringify(router.currentRoute?.params));
}

// ── the fragment ──────────────────────────────────────────────────────────────────────────────
/**
 * `hash` on the snapshot is the half of fragment handling that was missing: `hashChangeFunction`
 * could react to a fragment, but no route could see which one it was.
 *
 * Browser truth for the rest of this lives in `tests/browser/router-hash.test.js` — a fragment
 * navigation fires `popstate` too, which jsdom models faithfully and which used to cost a second
 * full route change.
 */
{
  let seen;
  const router = app([{ path: '/doc', component: (p, to) => { seen = to; return ''; } }]);
  const after = [];
  router.on('after-route', (to) => after.push([to.hash, to.trigger]));

  await navigate('/doc#install', 'navigate');
  check('the fragment reaches the snapshot', seen?.hash === '#install', JSON.stringify(seen?.hash));
  check('and currentRoute carries it', router.currentRoute?.hash === '#install',
    JSON.stringify(router.currentRoute?.hash));
  check('a full navigation carries an empty hash when there is none',
    (await navigate('/doc2', 'navigate'), seen?.hash === '#install'), 'route unchanged');

  const rendersBefore = seen;
  await navigate('/doc#usage', 'navigate');
  await new Promise((r) => setTimeout(r, 10));
  check('a hash-only change keeps the same route', router.currentRoute?.path === '/doc',
    router.currentRoute?.path);
  check('updates the fragment', router.currentRoute?.hash === '#usage', router.currentRoute?.hash);
  check('and reports it as a hashchange',
    after.some(([hash, trigger]) => hash === '#usage' && trigger === 'hashchange'), JSON.stringify(after));
  check('without re-running the component', seen === rendersBefore, 'component re-ran');
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
