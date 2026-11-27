import { expect } from '@esm-bundle/chai';
import { initRouter, navigate, setRouterRenderer } from '../../packages/router/dist/development/vera-router.js';
import { until } from './until.js';

/**
 * Scroll restore through REAL history, in a real engine: what Back reads is whatever the engine kept for that entry,
 * not a state a test handed to a synthetic `popstate` (jsdom's rows in `router-scroll-stamp.test.mjs` do that).
 *
 * An entry the router pushes is born with the state `0` (at the top), and leaving it rewrites the stamp only when the
 * page was scrolled. So a scrolled entry must come back at its offset, an unscrolled one at the top even when the page
 * was scrolled elsewhere just before Back, and the unscrolled entry must still carry its birth state after the round
 * trip (it was never stamped).
 */

setRouterRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : '';
});

/** Resolves once the engine has fired `popstate` for a traversal started after it is armed. */
const popped = () => {
  let fired = false;
  addEventListener('popstate', () => (fired = true), { once: true });
  return () => until(() => fired, "the engine's popstate", 4000);
};

const startPath = location.pathname;
const spacer = document.createElement('div');
spacer.style.height = '5000px';

beforeEach(() => document.body.appendChild(spacer));
afterEach(() => {
  spacer.remove();
  scrollTo(0, 0);
  history.replaceState(null, '', startPath);
});

it('Back restores a scrolled entry, lands an unscrolled one at the top, and a pushed entry is born 0', async () => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  initRouter(el, { view, handleInitial: false, focusView: false }).addRoutes([
    { path: '/bs-a', component: () => '<p>a</p>' },
    { path: '/bs-b', component: () => '<p>b</p>' },
    { path: '/bs-c', component: () => '<p>c</p>' },
  ]);

  await navigate('/bs-a');
  expect(history.state, 'an entry the router pushed is born with the state 0').to.equal(0);
  await navigate('/bs-b');
  scrollTo(0, 400);
  expect(scrollY, 'CONTROL: the page scrolls').to.equal(400);
  await navigate('/bs-c');
  expect(scrollY, 'a fresh navigation lands at the top').to.equal(0);

  let back = popped();
  history.back();
  await back();
  await until(() => location.pathname === '/bs-b' && scrollY === 400, 'Back to the scrolled entry restores 400', 4000);

  back = popped();
  history.back();
  await back();
  await until(() => location.pathname === '/bs-a' && scrollY === 0, 'Back to the unscrolled entry lands at the top', 4000);
  expect(history.state, 'the unscrolled entry was never stamped: still its birth state').to.equal(0);
  el.remove();
});
