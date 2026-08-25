/**
 * Nested views, specificity ranking, aliases, per-route guards, `removeRoute`, relative links.
 *
 * Every block tears its router down before the next one builds — routers are page-wide and all of
 * them follow every navigation, so a catch-all left registered by one block silently satisfies the
 * next block's assertions.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { load } from './dist.mjs';
import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});
const dom = new JSDOM('<div></div>', { url: 'http://localhost/start', virtualConsole });
const { window } = dom;
window.scrollTo = () => {};
for (const k of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent', 'Element', 'ShadowRoot', 'URL'])
  globalThis[k] = window[k];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = () => {};

const { initRouter, navigate, resolve, back, forward, go, setRouterRenderer } = await load('router');
/** Writes real markup, so a parent's nested outlet exists for its child to render into. */
setRouterRenderer((template, view) => { view.innerHTML = typeof template === 'string' ? template : ''; });

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
  return { router, element, view };
};

// ── nested views ──────────────────────────────────────────────────────────────────────────────
/**
 * `children` renders the whole chain now, outermost first, each level into a view found inside the
 * one above it. It used to prefix paths and nothing else: `/settings/profile` rendered the child
 * alone and the parent never ran.
 */
{
  const order = [];
  const { router, view } = app([
    {
      path: '/settings',
      component: () => { order.push('parent'); return '<h1>Settings</h1><section view="main"></section>'; },
      children: [
        { path: '/profile', component: () => { order.push('child'); return '<p>Profile</p>'; } },
      ],
    },
  ]);

  await navigate('/settings/profile', 'navigate');
  check('a nested route renders parent then child', order.join('>') === 'parent>child', order.join('>'));
  check('the child renders inside the parent\'s outlet',
    view.innerHTML === '<h1>Settings</h1><section view="main"><p>Profile</p></section>', view.innerHTML);

  order.length = 0;
  await navigate('/settings', 'navigate');
  check('the parent alone renders at its own path', order.join('>') === 'parent', order.join('>'));
  check('and its outlet is left empty',
    view.innerHTML === '<h1>Settings</h1><section view="main"></section>', view.innerHTML);
  router.deleteRouter();
}

/** A nested outlet may reuse the router's own view name — each level searches inside the last. */
{
  const { router, view } = app([
    {
      path: '/a',
      component: () => '<div view="main"></div>',
      children: [{ path: '/b', component: () => '<div view="main"></div>', children: [{ path: '/c', component: () => 'deep' }] }],
    },
  ]);
  await navigate('/a/b/c', 'navigate');
  check('three levels nest', view.textContent === 'deep', JSON.stringify(view.textContent));
  check('and each sits inside the last',
    view.querySelector('[view="main"] [view="main"]')?.textContent === 'deep',
    view.innerHTML);
  router.deleteRouter();
}

// ── specificity ranking ───────────────────────────────────────────────────────────────────────
/**
 * Registered deliberately worst-first. Before ranking, the catch-all declared on line one
 * swallowed every path and neither of the others was reachable.
 */
{
  const seen = [];
  const { router } = app([
    { path: '/*rest', component: () => { seen.push('splat'); return ''; } },
    { path: '/u/:id', component: () => { seen.push('param'); return ''; } },
    { path: '/u/new', component: () => { seen.push('literal'); return ''; } },
  ]);
  await navigate('/u/new', 'navigate');
  check('a literal beats a param declared before it', seen.pop() === 'literal');
  await navigate('/u/7', 'navigate');
  check('a param beats a catch-all declared before it', seen.pop() === 'param');
  await navigate('/somewhere/else', 'navigate');
  check('the catch-all still catches what nothing else does', seen.pop() === 'splat');
  router.deleteRouter();
}

{
  const seen = [];
  const { router } = app([
    { path: '/o/:a?', component: () => { seen.push('optional'); return ''; } },
    { path: '/o/:a', component: () => { seen.push('required'); return ''; } },
  ]);
  await navigate('/o/1', 'navigate');
  check('a required param outranks an optional one', seen.pop() === 'required', seen.join());
  router.deleteRouter();
}

// ── alias ─────────────────────────────────────────────────────────────────────────────────────
{
  let hits = 0;
  const { router } = app([{ path: '/team', name: 'team', alias: ['/staff', '/people'], component: () => { hits++; return ''; } }]);
  await navigate('/team', 'navigate');
  await navigate('/staff', 'navigate');
  await navigate('/people', 'navigate');
  check('every alias reaches the route', hits === 3, `${hits} hits`);
  check('and the URL stays the one that was used', window.location.pathname === '/people', window.location.pathname);
  check('resolve still builds the canonical path', resolve('team') === '/team', resolve('team'));
  router.deleteRouter();
}

// ── beforeEnter ───────────────────────────────────────────────────────────────────────────────
{
  const calls = [];
  const { router } = app([
    {
      path: '/gate',
      component: () => '<div view="main"></div>',
      beforeEnter: () => { calls.push('parent'); },
      children: [{ path: '/inner', component: () => '', beforeEnter: () => { calls.push('child'); } }],
    },
  ]);
  await navigate('/gate/inner', 'navigate');
  check('beforeEnter runs outermost first', calls.join('>') === 'parent>child', calls.join('>'));
  router.deleteRouter();
}

{
  let rendered = 0;
  const { router } = app([{ path: '/blocked', beforeEnter: () => false, component: () => { rendered++; return ''; } }]);
  const routed = await navigate('/blocked', 'navigate');
  check('beforeEnter returning false cancels', routed === false && rendered === 0, `${routed} / ${rendered}`);
  router.deleteRouter();
}

/** A parent refusing must stop the child before it does any work — that is the point of the chain. */
{
  let child = 0;
  const { router } = app([
    {
      path: '/pgate',
      beforeEnter: () => false,
      component: () => '<div view="main"></div>',
      children: [{ path: '/deep', component: () => { child++; return ''; } }],
    },
  ]);
  await navigate('/pgate/deep', 'navigate');
  check('a parent guard stops its child', child === 0, `child ran ${child}x`);
  router.deleteRouter();
}

// ── removeRoute ───────────────────────────────────────────────────────────────────────────────
{
  const { router } = app([
    { path: '/temp', name: 'temp', alias: '/tmp', component: () => '' },
    { path: '/keep', name: 'keep', component: () => '' },
  ]);
  check('removeRoute reports what it did', router.removeRoute('temp') === true);
  check('the route stops matching', (await navigate('/temp', 'navigate')) === false);
  check('its alias goes with it', (await navigate('/tmp', 'navigate')) === false);
  check('its name is unregistered', resolve('temp') === '');
  check('other routes are untouched', (await navigate('/keep', 'navigate')) === true);
  check('removing it twice is honest', router.removeRoute('temp') === false);
  router.deleteRouter();
}

// ── relative and external links ───────────────────────────────────────────────────────────────
/**
 * Resolved as a browser resolves an `href`, not as React Router resolves a `<Link to>`. A `route`
 * attribute must not change where a link points, or the same markup would go to two different
 * places depending on whether the script ran.
 */
{
  const { router, element } = app([
    { path: '/docs/intro', component: () => '' },
    { path: '/docs/edit', component: () => '' },
    { path: '/other', component: () => '' },
  ]);
  const click = async (href) => {
    const link = window.document.createElement('a');
    link.setAttribute('route', '');
    link.setAttribute('href', href);
    element.appendChild(link);
    link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
  };

  await navigate('/docs/intro', 'navigate');
  await click('edit');
  check('a bare relative href resolves against the URL', window.location.pathname === '/docs/edit',
    window.location.pathname);
  await click('../other');
  check('and so does a dot-dot href', window.location.pathname === '/other', window.location.pathname);

  const before = window.location.pathname;
  await click('https://example.com/other');
  check('a cross-origin href is left to the browser', window.location.pathname === before,
    window.location.pathname);
  router.deleteRouter();
}

// ── a view name is data, not a selector ───────────────────────────────────────────────────────
/**
 * `view` may be a function, and its result may derive from URL params — so the name is
 * attacker-influenced. It used to be interpolated into `[view="…"]` with only `"` escaped, which is
 * not enough: `a\\"` becomes `a\\\\"`, read by CSS as a literal backslash followed by a string
 * terminator. A crafted URL threw a DOMException out of `navigate`, and a payload that parsed would
 * have picked an element the author never marked as an outlet.
 *
 * Nothing builds a selector from the name now, so there is no grammar left to escape into.
 */
{
  const element = window.document.createElement('div');
  element.innerHTML = '<main view="public"></main><aside view="admin">SECRET</aside>';
  window.document.body.appendChild(element);
  const painted = [];
  /**
   * One renderer that records, rather than an observer registered alongside the real one. The
   * standalone `setRouterRenderer` replaces rather than appends — matching core's `setRenderer`,
   * where the same priority replaces — so stacking two is a job for the registry path.
   */
  setRouterRenderer((template, view) => painted.push(view.getAttribute('view')));
  const router = initRouter(element, { view: 'public', focusView: false, handleInitial: false });
  router.addRoutes([{ path: '/v/:name', view: (params) => params.name, component: () => 'ATTACKER' }]);

  await navigate('/v/public', 'navigate');
  check('a plain view name still resolves', painted.pop() === 'public');

  for (const payload of ['a\\"], [view="admin', 'a\\"], aside /*', 'a\\', '*', '[view]']) {
    painted.length = 0;
    let threw = null;
    try {
      await navigate('/v/' + encodeURIComponent(payload), 'navigate');
    } catch (error) {
      threw = error.constructor.name;
    }
    check(`a crafted view name neither throws nor matches: ${JSON.stringify(payload)}`,
      threw === null && painted.length === 0, threw ?? JSON.stringify(painted));
  }
  check('the element it was aiming at is untouched',
    element.querySelector('[view="admin"]').textContent === 'SECRET');
  router.deleteRouter();
}

/** The security block above swapped the renderer for a recorder; put the real one back. */
setRouterRenderer((template, view) => { view.innerHTML = typeof template === 'string' ? template : ''; });

// ── history helpers ───────────────────────────────────────────────────────────────────────────
check('back, forward and go are exported', [back, forward, go].every((f) => typeof f === 'function'));


/* ── a child path works with or without a leading slash ───────────────────────────────────────
 * Vue Router and React Router both write children relatively — `path: 'profile'` under `/settings`
 * — and that is the first thing anyone tries. The two were concatenated verbatim, so the relative
 * form registered `/settingsprofile`: a route nobody can navigate to, added without complaint, so
 * the catch-all answered `/settings/profile` instead.
 *
 * An empty child path is the index route and must stay the parent's own URL.
 */
{
  for (const [label, parentPath, childPath, expected] of [
    ['with a leading slash', '/slash', '/profile', 'child'],
    ['relatively', '/relative', 'profile', 'child'],
    ['as an index route', '/index', '', 'parent'],
  ]) {
    /**
     * A distinct parent per case, because `navigate` dedupes on the current path: navigating three
     * times to `/settings/profile` performs one navigation and the other two cases would assert
     * against a router that never ran.
     */
    const { router, view } = app([
      {
        path: parentPath,
        component: () => '<div view="panel"></div>',
        children: [{ path: childPath, view: 'panel', component: () => 'child' }],
      },
      { path: '/*rest', component: () => 'catch-all' },
    ]);
    await navigate(childPath === '' ? parentPath : `${parentPath}/profile`, 'navigate');
    const markup = view.innerHTML;
    check(
      `a child path written ${label} reaches the child`,
      expected === 'child' ? markup.includes('child') : markup.includes('view="panel"'),
      markup
    );
    check(`and does not fall through to the catch-all: ${label}`, !markup.includes('catch-all'), markup);
    router.deleteRouter();
  }
}

/* ── the root route beats a catch-all ──────────────────────────────────────────────────────────
 * `/` has no segments, so it scored 0 while `/*rest` scored 1: every app with a 404 route served
 * the 404 at its own home page. A wildcard now costs rather than scores, so it can never outrank a
 * route that also matches.
 */
{
  const { router, view } = app([
    { path: '/*rest', component: () => 'catch-all' },
    { path: '/', component: () => 'home' },
  ]);
  await navigate('/', 'navigate');
  check('the root route beats a catch-all declared before it', view.innerHTML.includes('home'), view.innerHTML);

  await navigate('/somewhere/else', 'navigate');
  check('and the catch-all still catches everything else', view.innerHTML.includes('catch-all'), view.innerHTML);
  router.deleteRouter();
}

/* ── a relative path is relative at every depth, the root included ─────────────────────────────
 * `join` used to short-circuit on an empty parent, so the relative spelling worked one level down
 * and silently failed at the top: `path: 'about'` registered the pattern `about`, which cannot
 * match the pathname `/about`, and every child under it inherited the broken prefix. Nothing threw
 * — the catch-all simply answered, which is the hardest kind of routing bug to see.
 *
 * Both spellings are checked at both depths, and `resolve` is checked with them, because a name
 * that builds a slashless URL navigates relative to wherever the user happens to be.
 */
for (const [label, top, child] of [
  ['relative', 'docs', 'intro'],
  ['absolute', '/docs', '/intro'],
  ['mixed', '/docs', 'intro'],
  ['mixed the other way', 'docs', '/intro'],
]) {
  const { router, view } = app([
    {
      path: top,
      name: 'docs',
      component: () => 'parent<section view="panel"></section>',
      children: [{ path: child, name: 'intro', view: 'panel', component: () => 'child' }],
    },
    { path: '/*rest', component: () => 'catch-all' },
  ]);

  await navigate('/docs', 'navigate');
  check(`a top-level path written ${label} matches`, view.innerHTML.includes('parent'), view.innerHTML);
  await navigate('/docs/intro', 'navigate');
  check(`and its child matches too: ${label}`, view.innerHTML.includes('child'), view.innerHTML);
  check(`neither falls through to the catch-all: ${label}`, !view.innerHTML.includes('catch-all'), view.innerHTML);
  check(`resolve builds an absolute URL: ${label}`, resolve('docs') === '/docs', resolve('docs'));
  check(`resolve builds an absolute child URL: ${label}`, resolve('intro') === '/docs/intro', resolve('intro'));
  router.deleteRouter();
}

/* ── an alias carries the route's children ─────────────────────────────────────────────────────
 * An alias is the same route at another URL, so everything under it is reachable there as well.
 * It used to be the parent only: `/people` rendered and `/people/new` was a 404, with no way to
 * tell from the route table why. The alias itself is also joined like any other path, so the
 * relative spelling works here too.
 *
 * `names` must stay pointed at the canonical URL — a child registered under three aliases must not
 * leave `resolve` building the last one, and must not warn about a name the author wrote once.
 */
{
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  const { router, view } = app([
    { path: '/', component: () => 'home' },
    {
      path: '/users',
      name: 'users',
      alias: ['/people', 'folks'],
      component: () => 'users<section view="panel"></section>',
      children: [
        { path: 'new', name: 'new-user', view: 'panel', component: () => 'new' },
        { path: ':id', name: 'user', view: 'panel', component: () => 'one' },
      ],
    },
    { path: '/*rest', component: () => 'catch-all' },
  ]);
  console.warn = realWarn;

  for (const base of ['/users', '/people', '/folks']) {
    await navigate(base, 'navigate');
    check(`${base} reaches the route`, view.innerHTML.includes('users'), view.innerHTML);
    await navigate(`${base}/new`, 'navigate');
    check(`${base}/new reaches the static child`, view.innerHTML.includes('new'), view.innerHTML);
    await navigate(`${base}/7`, 'navigate');
    check(`${base}/7 reaches the param child`, view.innerHTML.includes('one'), view.innerHTML);
  }

  check('an alias never outranks the root', ((await navigate('/', 'navigate')), view.innerHTML.includes('home')), view.innerHTML);
  check('a name still resolves to the canonical URL', resolve('user', { id: 7 }) === '/users/7', resolve('user', { id: 7 }));
  check('and so does a static child', resolve('new-user') === '/users/new', resolve('new-user'));
  check('registering under an alias warns about nothing', warnings.length === 0, warnings.join(' | '));
  router.deleteRouter();
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
