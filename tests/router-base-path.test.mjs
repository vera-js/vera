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
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/app/start' });
const { window } = dom;
for (const key of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent']) globalThis[key] = window[key];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

const { initRouter, navigate, resolve, setBasePath } = await load('router');
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


/**
 * **Every shape a `<base>` can take, against one table.**
 *
 * The mount point has been derived wrongly three times in this feature's first day, and all three
 * were one bug: *the base silently became the current page*. It arrived through no `<base>` at all,
 * then through `<base target="_blank">` (valid, carries no URL), then through `<base href="">`
 * (matches `base[href]`, resolves to the document). Each spot fix closed one door and left the
 * others open, and a test pinning one spelling did not protect against the next.
 *
 * So this is a table rather than three tests. It is the guard that actually generalises: any future
 * change to how the base is read has to answer for every shape at once, and a new door added to the
 * platform is one row here rather than a rediscovery.
 *
 * **Measured, not reasoned.** `tests/browser/base-element-matrix.test.js` asserts these same answers
 * in Chromium, Firefox and WebKit, and jsdom agrees with all three on every row — checked before
 * this file was written, because jsdom is the regression net and never the oracle for a rule the
 * platform owns.
 *
 * The document is at `http://localhost/app/start`, so a RELATIVE base resolves against `/app/`.
 */
/** A row whose navigation the router should decline outright. */
const REFUSED = Symbol('refused');
const BASE_SHAPES = [
  ['no <base> at all',            '',                                    '/users'],
  ['<base> with no href',         '<base target="_blank">',              '/users'],
  ['<base href=""> — empty',      '<base href="">',                      '/users'],
  ['absolute, trailing slash',    '<base href="/mount/">',               '/mount/users'],
  ['absolute, no trailing slash', '<base href="/mount">',                '/mount/users'],
  ['relative to the document',    '<base href="sub/">',                  '/app/sub/users'],
  ['first <base> has no href',    '<base target="_top"><base href="/mount/">', '/mount/users'],
  ['two with href — first wins',  '<base href="/first/"><base href="/second/">', '/first/users'],
  /**
   * A cross-origin base is not "no base" — it is a page whose URLs all point somewhere else, which
   * is what the PLATFORM says too: under `<base href="https://other.test/x/">` the browser takes
   * `<a href="/users">` to `https://other.test/users`. So the router declines the navigation rather
   * than pretending, exactly as it declines a cross-origin link, and says so. The mount point is
   * empty either way, which is why asserting only the derived base would have missed this.
   */
  ['cross-origin, absolute',      '<base href="https://other.test/x/">', REFUSED],
  ['cross-origin, protocol-rel',  '<base href="//other.test/x/">',       REFUSED],
];

test('the base is read correctly from every shape a <base> element can take', async () => {
  setBasePath(null);
  mount([...ROUTES, { path: '/users/:id', name: 'matrix-user', component: () => { hit = 'one user'; return ''; } }]);
  const wrong = [];

  try {
    for (const [label, markup, expected] of BASE_SHAPES) {
      /**
       * Three-step setup, and the ORDER is the point. Every row navigates to the same route, and
       * navigating to the route the router is already on is a no-op — the exact trap `reset()`
       * exists for, which the first version of this loop fell into per row: row one passed and
       * every later row silently tested nothing. So: clear the head and reset the router to `/`
       * FIRST (with no base in effect), then park the URL at `/app/start` so a RELATIVE base
       * resolves from one known place, then install the row's `<base>`.
       */
      doc.head.innerHTML = '';
      await reset();
      window.history.replaceState(null, '', '/app/start');
      doc.head.innerHTML = markup;
      await navigate('/users', 'navigate');
      await tick();
      const actual = window.location.pathname;
      if (expected === REFUSED) {
        if (actual !== '/app/start') wrong.push({ label, markup, expected: 'refused, URL unchanged', actual });
        /**
         * The half `navigate` cannot cover for. Its own origin guard refuses these navigations
         * before the derived base is ever consulted — so dropping `basePath`'s origin check
         * changed NOTHING the rows above can see, and the mutation survived. `resolve()` is the
         * path with no guard in front: it hands its pattern straight to `addBase`, and with the
         * check gone it built hrefs on another origin's pathname. This is the assertion that
         * failed for that mutation once it existed, and it lives inside the row so a new
         * cross-origin shape is covered by construction.
         */
        const built = resolve('matrix-user', { id: 7 });
        if (built !== '/users/7')
          wrong.push({ label, markup, note: 'resolve() built an href from a foreign base', built });
      } else if (actual !== expected) wrong.push({ label, markup, expected, actual });
      else if (hit !== 'users') wrong.push({ label, markup, note: 'URL right, route did not match', hit });
    }
  } finally {
    /** A leaked `<base>` re-points every later test in the file — the cross-origin rows made three
     *  of them fail in ways that read as unrelated defects. */
    doc.head.innerHTML = '';
    window.history.replaceState(null, '', '/app/start');
  }

  assert.deepEqual(wrong, [], 'every <base> shape must produce the mount point the platform implies');
});

/**
 * The control for the table above: without it, a `basePath` returning `''` unconditionally would
 * pass eight of ten rows and look broadly healthy.
 */
test('CONTROL: the table distinguishes a real base from none', async () => {
  setBasePath(null);
  mount(ROUTES);
  try {
    doc.head.innerHTML = '';
    await reset();
    window.history.replaceState(null, '', '/app/start');
    doc.head.innerHTML = '<base href="/mount/">';
    await navigate('/users', 'navigate');
    await tick();
    assert.equal(window.location.pathname, '/mount/users', 'a real base moves the URL');
  } finally {
    doc.head.innerHTML = '';
  }
  await reset();
  await navigate('/users/5', 'navigate');
  await tick();
  assert.equal(window.location.pathname, '/users/5', 'and removing it moves the URL back');
});

/**
 * **The page-load path, which is the one that actually matters.**
 *
 * Everything above navigates from inside an already-running app. A real visitor arrives at
 * `/app/users/5` cold, and `handleInitial` is what routes that — a different code path from
 * `popstate` and from `navigate`, reading `location` before any navigation has happened. If the
 * base were not stripped there, a deployed app would show its 404 view on every fresh load and
 * work perfectly once you clicked something, which is a uniquely confusing way to fail.
 *
 * Params are asserted, not just the match: stripping the wrong number of characters still matches a
 * `:id` route and quietly hands the component the wrong id.
 */
test('a cold load on a mounted URL routes, with params intact', async () => {
  setBasePath('/app');
  /**
   * Third appearance of the same-route no-op trap in this file: the test before this one happens
   * to END on `/users/5`, so `handleInitial`'s own navigation to `/users/5` was a no-op and this
   * read as "cold load broken" when it meant "nothing ran". Reset to `/` first, so the cold load
   * is genuinely a navigation.
   */
  await reset();
  window.history.replaceState(null, '', '/app/users/5');

  let params = null;
  const host = doc.createElement('div');
  const view = doc.createElement('main');
  host.appendChild(view);
  doc.body.appendChild(host);
  const router = initRouter(host, { view, focusView: false, handleInitial: true });
  router.addRoutes([
    { path: '/', component: () => { hit = 'home'; return ''; } },
    { path: '/users/:id', component: (p) => { hit = 'one user'; params = p; return ''; } },
  ]);
  await tick();
  await tick();

  assert.equal(hit, 'one user', 'the landing URL matched its route');
  assert.equal(params?.id, '5', 'and the param is the id, not a fragment of the base');
  assert.equal(window.location.pathname, '/app/users/5', 'the URL the visitor typed is left alone');
  setBasePath(null);
});

/**
 * **`resolve()` returns a URL you can put in an href, not a route path.**
 *
 * Under a base those are two strings for one destination, and returning the route path made this a
 * trap: `href=${resolve('user', { id })}` gave `/users/5` on an app mounted at `/app`. The router
 * re-bases that when the link is CLICKED, so it navigates correctly — and it is a wrong URL
 * everywhere the router is not involved: a new tab, a copied link, a crawler, JS disabled. The one
 * path anybody tests is the one path that works.
 *
 * It costs no new API because `navigate` accepts either spelling — every string it receives is
 * resolved and stripped — so both uses are now correct with one return value.
 */
test('resolve() returns the mounted path, and navigate still accepts it', async () => {
  setBasePath('/app');
  mount([...ROUTES, { path: '/users/:id', name: 'user', component: () => { hit = 'one user'; return ''; } }]);
  assert.equal(resolve('user', { id: 5 }), '/app/users/5', 'href-ready: the URL a browser can follow');

  await reset();
  await navigate(resolve('user', { id: 5 }), 'navigate');
  await tick();
  assert.equal(hit, 'one user', 'and handing it straight back to navigate still routes');
  assert.equal(window.location.pathname, '/app/users/5', 'without doubling the base');
  setBasePath(null);
});

test('resolve() is unchanged for an app at the origin root', () => {
  setBasePath(null);
  mount([...ROUTES, { path: '/users/:id', name: 'user2', component: () => '' }]);
  assert.equal(resolve('user2', { id: 5 }), '/users/5', 'no base, no difference');
});

/**
 * The net for the hrefs `resolve()` never sees. A `route` attribute means the router handles this
 * link, so under a base its href belongs inside the base; one in route space navigates fine and is
 * a broken URL outside the router. Development-only, and asserted rather than assumed — a
 * diagnostic nobody has watched fire is a diagnostic that may not.
 */
test('a routed href pointing outside the base is diagnosed', { skip: isProduction }, async () => {
  setBasePath('/app');
  const { host } = mount(ROUTES);
  await reset();

  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    const link = doc.createElement('a');
    link.setAttribute('route', '');
    link.setAttribute('href', '/users');
    host.appendChild(link);
    link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await tick();
  } finally {
    console.warn = warn;
  }

  const message = said.find((line) => line.includes('points outside'));
  assert.ok(message, `expected a warning about the base, got: ${JSON.stringify(said)}`);
  assert.match(message, /\[vera\]/, 'carries the house prefix so one filter finds every diagnostic');
  assert.match(message, /"\/app\/users"/, 'and names the href the author should have written');
  setBasePath(null);
});


/**
 * The base composed with supersession (run-2's committedId fix): the same-path early return and
 * the ticket bump must both operate on the SAME normalization of the path, or under a base one of
 * two things breaks — "already there" false-negatives (an extra render, harmless) or
 * false-positives (a swallowed navigation, the R2P3 defect resurrected one layer up). Both halves
 * pinned: same-path stays a no-op under a base, and a stay-here click during a slower in-flight
 * navigation supersedes it, view-model and URL both carrying the base.
 */
test('the same-path no-op and the in-flight supersession both hold under a base', async () => {
  setBasePath('/app');
  const finished = [];
  const { view } = mount([
    { path: '/home', component: () => { finished.push('home'); return 'HOME'; } },
    { path: '/lazy', component: async () => { await new Promise((r) => setTimeout(r, 50)); finished.push('lazy'); return 'LAZY'; } },
  ]);
  await navigate('/home', 'navigate');
  await tick();
  assert.equal(window.location.pathname, '/app/home', 'CONTROL: the based navigation landed');
  const runs = finished.length;
  await navigate('/home', 'navigate');
  await tick();
  assert.equal(finished.length, runs, 'same path under a base: a no-op, not a re-render');

  const inFlight = navigate('/lazy', 'navigate');
  await new Promise((r) => setTimeout(r, 5));
  const stay = navigate('/home', 'navigate');
  await Promise.all([inFlight, stay]);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(finished[finished.length - 1], 'lazy', 'CONTROL: the race was real — the slow component finished last');
  assert.equal(window.location.pathname, '/app/home', 'the abandoned navigation never took the URL');
  void view;
  setBasePath(null);
});
