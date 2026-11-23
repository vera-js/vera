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
const { initRouter, currentRoute } = await load('router');

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
