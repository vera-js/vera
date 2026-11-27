/**
 * **The fragment starts at the FIRST `#`**, as the URL parser reads it (2026-11-23). A fragment may hold `#` itself:
 * `/p#!/x#y` is path `/p` and hash `#!/x#y`. The router split at the LAST `#`, so a landing URL like that matched
 * `/p#!/x` (no route: not-found), and `/search?q=a#top#x` read its query as `q=a#top`. Pinned end to end: landing on
 * each, the route that matches and what `currentRoute()` reports, against `new URL`'s own reading. CONTROL: a URL with
 * one `#` reads the same either way.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
const { window } = dom;
for (const key of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent']) globalThis[key] = window[key];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
const { initRouter, currentRoute, navigate } = await load('router');

/** Lands on `url` (the browser's address, then the router's initial read) with routes that record which matched. */
const land = async (url) => {
  window.history.replaceState(null, '', url);
  const hits = [];
  const host = document.createElement('div');
  const view = document.createElement('main');
  host.appendChild(view);
  document.body.appendChild(host);
  const router = initRouter(host, { view, focusView: false });
  router.addRoutes([
    { path: '/p', component: () => { hits.push('p'); return ''; } },
    { path: '/search', component: () => { hits.push('search'); return ''; } },
    { path: '*', component: () => { hits.push('not-found'); return ''; } },
  ]);
  await tick();
  return { hits, route: currentRoute() };
};

for (const [href, route] of [['/p#!/x#y', 'p'], ['/search?q=a#top#x', 'search'], ['/p#one', 'p']])
  test(`landing on ${href}: the route, query and hash the URL parser reads`, async () => {
    const url = new URL(href, 'http://localhost');
    const { hits, route: current } = await land(href);
    assert.equal(hits.at(-1), route, 'the route that matched');
    assert.equal(current.path, url.pathname);
    assert.equal(current.query.toString(), url.searchParams.toString());
    assert.equal(current.hash, url.hash);
  });

/**
 * **Only the PATH loses a trailing slash** (2026-11-27): a fragment or a query is not a path, so a slash at its end is
 * the author's. The router stripped the whole URL's last `/` before splitting off the fragment, so the route it handed
 * out (`after-route`, the guards) read `/q#!/x/`'s hash as `#!/x`, kept `/r/#top/`'s path slash and dropped the
 * fragment's, and read `/search/?q=a/`'s query as `q=a`. Each landing is on its own path (a landing on the path already
 * current is a hash change and routes nothing), read against `new URL`'s parts with the pathname's trailing slash
 * stripped. CONTROL: `/p/` alone still loses its slash.
 */
const landRoute = async (url) => {
  window.history.replaceState(null, '', url);
  const seen = [];
  const host = document.createElement('div');
  const view = document.createElement('main');
  host.appendChild(view);
  document.body.appendChild(host);
  const router = initRouter(host, { view, focusView: false });
  router.on('after-route', (to) => seen.push(to));
  router.addRoutes(['/p', '/q', '/r', '/search'].map((path) => ({ path, component: () => '' })).concat([{ path: '*', component: () => '' }]));
  await tick();
  return seen.at(-1);
};

for (const href of ['/q#!/x/', '/r/#top/', '/search/?q=a/', '/p/'])
  test(`landing on ${href}: the route has its path's trailing slash stripped, the fragment's and the query's kept`, async () => {
    const url = new URL(href, 'http://localhost');
    const to = await landRoute(href);
    assert.ok(to, 'CONTROL: the landing routed');
    assert.equal(to.path, url.pathname.replace(/(.)\/$/, '$1'), 'the path, its trailing slash stripped');
    assert.equal(to.hash, url.hash, 'the fragment as written');
    assert.equal(String(to.query ?? ''), url.searchParams.toString(), 'the query as written');
  });

/** What a navigation writes to the address bar follows the same rule: the path's trailing slash stripped, the rest kept. */
test("navigating to a URL with a trailing slash in its path, query or fragment: the address bar's path loses it, the rest keep theirs", async () => {
  await landRoute('/p');
  for (const href of ['/q/', '/r/?q=a/', '/search/#top/'])
    {
      await navigate(href);
      await tick();
      const url = new URL(href, 'http://localhost');
      assert.equal(window.location.pathname, url.pathname.replace(/(.)\/$/, '$1'), `${href}: the path`);
      assert.equal(window.location.search, url.search, `${href}: the query`);
      assert.equal(window.location.hash, url.hash, `${href}: the fragment`);
    }
});
