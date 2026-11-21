import { expect } from '@esm-bundle/chai';
import { initRouter, navigate, setRouterRenderer } from '../../packages/router/dist/development/vera-router.js';
import { until } from './until.js';

/**
 * Fragment navigation, in a real engine.
 *
 * The premise this was written to check turned out to be backwards, which is the reason it is
 * here. Assigning `location.hash` fires **`popstate` as well as `hashchange`** — in Chromium,
 * Firefox and WebKit alike, exactly as jsdom does. `popstate` is not traversal-only.
 *
 * That is what made every anchor click cost a second, full route change: the router's `popstate`
 * listener routed to `location.pathname`, which reads as a move away from `/docs#install` to
 * `/docs`. The component ran twice, guards re-ran under a `'popstate'` trigger, and because
 * `popstate` focuses every routed view, an in-page link stole focus.
 */

setRouterRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : '';
});

/**
 * **The engine's `hashchange`, waited for**: a fragment move (`location.hash` assigned, or `location.replace` under
 * `pushHash`) fires `popstate` then `hashchange`, both later; once `hashchange` has fired, both have reached the
 * router's own listeners. Arm it BEFORE the move. A fixed 60 ms said nothing about an event a loaded machine fires late,
 * and a re-render arriving after it would have been read as none.
 */
const hashMoved = () => {
  let moved = false;
  addEventListener('hashchange', () => (moved = true), { once: true });
  return () => until(() => moved, "the engine's hashchange", 4000);
};

/** A macrotask: whatever the router's listeners started from that event has run its synchronous part and microtasks. */
const task = () => new Promise((r) => setTimeout(r, 0));

const makeApp = (routes, options = {}) => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  const router = initRouter(el, { view, handleInitial: false, focusView: false, ...options });
  router.addRoutes(routes);
  return router;
};

const startPath = location.pathname;
afterEach(() => history.replaceState(null, '', startPath));

it('assigning location.hash fires popstate as well as hashchange', async () => {
  const fired = [];
  const onHash = () => fired.push('hashchange');
  const onPop = () => fired.push('popstate');
  window.addEventListener('hashchange', onHash);
  window.addEventListener('popstate', onPop);
  const moved = hashMoved();
  location.hash = '#probe-' + Math.random().toString(36).slice(2);
  await moved();
  window.removeEventListener('hashchange', onHash);
  window.removeEventListener('popstate', onPop);
  location.hash = '';

  expect(fired, 'hashchange fires').to.include('hashchange');
  /** Load-bearing: the router must survive this, not assume it away. */
  expect(fired, 'and so does popstate — this is why the listener carries the fragment').to.include('popstate');
});

it('a hash-only change keeps the route and updates the snapshot', async () => {
  let renders = 0;
  const router = makeApp([
    { path: '/bh-doc', component: () => { renders++; return '<p>doc</p>'; } },
  ]);
  const after = [];
  router.on('after-route', (to) => after.push([to.hash, to.trigger]));

  /** `navigate` resolves after the route is applied (rendered, focused, after-route emitted). */
  await navigate('/bh-doc', 'navigate');
  const rendersAfterRoute = renders;
  expect(rendersAfterRoute, 'CONTROL: the route rendered').to.equal(1);

  const moved = hashMoved();
  await navigate('/bh-doc#install', 'navigate');
  await moved();
  await task();

  expect(router.currentRoute.path).to.equal('/bh-doc');
  expect(router.currentRoute.hash).to.equal('#install');
  expect(renders, 'a fragment change must not re-render the route').to.equal(rendersAfterRoute);
  expect(after.some(([hash, trigger]) => hash === '#install' && trigger === 'hashchange')).to.equal(true);
});

it('the fragment reaches the snapshot on a full navigation too', async () => {
  let renders = 0;
  let seen;
  const router = makeApp([
    { path: '/bh-page', component: (params, to) => { renders++; seen = to; return '<p>p</p>'; } },
  ]);
  const moved = hashMoved();
  await navigate('/bh-page#section', 'navigate');
  await moved();
  await task();
  expect(seen.hash).to.equal('#section');
  expect(router.currentRoute.hash).to.equal('#section');
  expect(renders, 'one fragment navigation, one render').to.equal(1);
});
