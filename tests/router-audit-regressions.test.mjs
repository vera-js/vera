/**
 * Regressions found in the 2026-08-25 full-framework audit, router half.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://x.test/users?page=2&q=hats',
  pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.window = dom.window;

const { initRouter, setRouterRenderer, navigate } = await load('router');
setRouterRenderer(() => {});

/**
 * The query is part of the URL a page is *opened* with, and it reached routes only when a link was
 * clicked. Landing directly — a deep link, a refresh, a URL someone shared, a back traversal — built
 * the path from `pathname + hash` and dropped it, so `?page=2` and every filter in a bookmarked URL
 * were invisible on exactly the load that carried them.
 */
test('the query reaches routes on initial load, not only on link clicks', async () => {
  const element = document.createElement('div');
  const view = document.createElement('main');
  view.setAttribute('view', 'main');
  element.appendChild(view);
  document.body.appendChild(element);

  const seen = [];
  const router = initRouter(element, { view: 'main', focusView: false });
  router.addRoutes([
    {
      path: '/users',
      component: (params, to) => {
        seen.push(Object.fromEntries(to?.query ?? []));
        return '';
      },
    },
  ]);

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(seen, [{ page: '2', q: 'hats' }], 'the landing URL carried ?page=2&q=hats');

  seen.length = 0;
  await navigate('/users?page=7');
  assert.deepEqual(seen, [{ page: '7' }], 'and an explicit navigation still works');
});

/**
 * A routed link has always been checked against the page's origin before the router hijacks it —
 * `methods.ts` compares origins and lets the browser have anything else. The programmatic call had
 * no such check, and `navigate(params.get('next'))` is the ordinary way an app honours a `?next=`
 * redirect, so an open-redirect payload reached `pushState` and the browser refused it with a
 * `SecurityError` that nothing caught: the payload took the page down instead of being declined.
 */
test('navigate refuses a path that resolves to another origin', async () => {
  const element = document.createElement('div');
  const view = document.createElement('main');
  view.setAttribute('view', 'main');
  element.appendChild(view);
  document.body.appendChild(element);
  /** jsdom does not implement scrollTo, and the router calls it on a successful navigation. */
  window.scrollTo = () => {};

  const hits = [];
  const router = initRouter(element, { view: 'main', focusView: false, handleInitial: false });
  router.addRoutes([
    { path: '/u/:id', component: (params) => (hits.push(params.id), '') },
    { path: '/*rest', component: () => (hits.push('404'), '') },
  ]);

  for (const hostile of ['//evil.test/u/1', 'https://evil.test/u/1', 'http://evil.test/u/1']) {
    hits.length = 0;
    assert.equal(await navigate(hostile), false, `${hostile} must be refused`);
    assert.deepEqual(hits, [], 'and must not route anything, not even the catch-all');
  }

  /** A same-origin absolute URL is what a link already passes, so it routes — it used to 404. */
  hits.length = 0;
  assert.equal(await navigate('https://x.test/u/5'), true);
  assert.deepEqual(hits, ['5']);

  /** A relative path keeps its exact previous handling. */
  hits.length = 0;
  assert.equal(await navigate('/u/6'), true);
  assert.deepEqual(hits, ['6']);
});
