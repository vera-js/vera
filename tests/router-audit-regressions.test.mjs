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
