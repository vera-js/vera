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

/** Every router a test mounts, removed after it even when it fails, so a red row cannot lengthen the next one's page. */
const mounted = [];

beforeEach(() => document.body.appendChild(spacer));
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  spacer.remove();
  scrollTo(0, 0);
  history.replaceState(null, '', startPath);
});

it('Back restores a scrolled entry, lands an unscrolled one at the top, and a pushed entry is born 0', async () => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  mounted.push(el);
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

/**
 * Back or Forward to a fragment entry returns to where the entry was left, as every engine does across documents
 * (measured on all three, 2026-11-27), not to its anchor. The router writes the fragment with `location.replace`, which
 * on Chromium 159 and Firefox 159 resets the entry's state to null where WebKit 27.2 keeps the born `0`; leaving the
 * entry by a navigation stamps it either way. An entry never left by a navigation carries no stamp, and comes back to
 * its anchor.
 */
const fragmentRouter = (prefix) => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  mounted.push(el);
  initRouter(el, { view, handleInitial: false, focusView: false }).addRoutes([
    { path: `/${prefix}-c`, component: () => `<h2 id="${prefix}-sec">c</h2><div style="height:3000px"></div>` },
    { path: `/${prefix}-d`, component: () => '<p>d</p>' },
  ]);
  return el;
};

it('Back to a fragment entry left at its anchor comes back to the anchor', async () => {
  const el = fragmentRouter('bf');
  await navigate('/bf-c#bf-sec');
  await until(() => scrollY > 0, 'CONTROL: the anchor scrolled the page', 4000);
  const anchored = scrollY;
  await navigate('/bf-d');
  expect(scrollY, 'CONTROL: a fresh navigation lands at the top').to.equal(0);
  const back = popped();
  history.back();
  await back();
  await until(() => location.pathname === '/bf-c' && location.hash === '#bf-sec' && scrollY === anchored, `Back to the fragment entry restores ${anchored}`, 4000);
  el.remove();
});

it('Back to a fragment entry scrolled away from its anchor comes back where it was left, not to the anchor', async () => {
  const el = fragmentRouter('bg');
  await navigate('/bg-c#bg-sec');
  await until(() => scrollY > 0, 'CONTROL: the anchor scrolled the page', 4000);
  const anchored = scrollY;
  scrollTo(0, anchored + 1000);
  const away = scrollY;
  expect(away, 'CONTROL: the page scrolled away from the anchor').to.equal(anchored + 1000);
  await navigate('/bg-d');
  expect(scrollY, 'CONTROL: a fresh navigation lands at the top').to.equal(0);
  const back = popped();
  history.back();
  await back();
  await until(() => location.pathname === '/bg-c' && location.hash === '#bg-sec' && scrollY === away, `Back to the scrolled fragment entry restores ${away}, not the anchor's ${anchored}`, 4000);
  el.remove();
});

it('Forward to a fragment entry never left by a navigation comes back to its anchor', async () => {
  const el = fragmentRouter('bh');
  await navigate('/bh-d');
  await navigate('/bh-c#bh-sec');
  await until(() => scrollY > 0, 'CONTROL: the anchor scrolled the page', 4000);
  const anchored = scrollY;
  /** Back is a traversal, not a navigation: it leaves the fragment entry unstamped (null, or WebKit's born 0). */
  let moved = popped();
  history.back();
  await moved();
  await until(() => location.pathname === '/bh-d' && scrollY === 0, 'CONTROL: Back reached the plain entry at the top', 4000);
  expect([null, 0], 'CONTROL: the fragment entry carries no stamp').to.include(await new Promise((resolve) => {
    addEventListener('popstate', (e) => resolve(e.state), { once: true });
    moved = until(() => location.pathname === '/bh-c', 'Forward reached the fragment entry', 4000);
    history.forward();
  }));
  await moved;
  await until(() => location.hash === '#bh-sec' && scrollY === anchored, `Forward to the unstamped fragment entry lands on its anchor at ${anchored}`, 4000);
  el.remove();
});

it('Back to an entry scrolled past the end of the next, shorter route comes back where it was left', async () => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  mounted.push(el);
  initRouter(el, { view, handleInitial: false, focusView: false }).addRoutes([
    { path: '/bl-long', component: () => '<div style="height:6000px"></div>' },
    { path: '/bl-short', component: () => '<p>short</p>' },
  ]);
  spacer.remove();
  await navigate('/bl-long');
  scrollTo(0, 5000);
  const left = scrollY;
  expect(left, 'CONTROL: the long route scrolls to 5000').to.equal(5000);
  await navigate('/bl-short');
  expect(document.documentElement.scrollHeight - innerHeight < left, 'CONTROL: the short route cannot scroll that far').to.equal(true);
  const back = popped();
  history.back();
  await back();
  await until(() => location.pathname === '/bl-long' && scrollY === left, `Back to the long entry restores ${left}`, 4000);
  el.remove();
});

it('a scroll made while the next route loads is the position Back comes back to', async () => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  mounted.push(el);
  let loaded;
  initRouter(el, { view, handleInitial: false, focusView: false }).addRoutes([
    { path: '/bw-long', component: () => '<div style="height:6000px"></div>' },
    { path: '/bw-slow', load: () => new Promise((resolve) => (loaded = resolve)), component: () => '<p>slow</p>' },
  ]);
  await navigate('/bw-long');
  scrollTo(0, 1000);
  const going = navigate('/bw-slow');
  await until(() => loaded, 'CONTROL: the slow route is loading', 4000);
  scrollTo(0, 3000);
  expect(scrollY, 'CONTROL: the page scrolled during the load').to.equal(3000);
  loaded();
  await going;
  expect(location.pathname, 'CONTROL: the slow route committed').to.equal('/bw-slow');
  const back = popped();
  history.back();
  await back();
  await until(() => location.pathname === '/bw-long' && scrollY === 3000, 'Back restores the position at the swap (3000), not at the click (1000)', 4000);
  el.remove();
});

/**
 * The documented edge of the row above: the position is read when the new route begins rendering, so a scroll made
 * while an async `component` is pending is not kept. Pinned so a change either way is a decision, not drift.
 */
it('a scroll made while an async component is pending is not kept: Back comes back to where rendering began', async () => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  mounted.push(el);
  let paint;
  initRouter(el, { view, handleInitial: false, focusView: false }).addRoutes([
    { path: '/bc-long', component: () => '<div style="height:6000px"></div>' },
    { path: '/bc-slow', component: () => new Promise((resolve) => (paint = resolve)) },
  ]);
  await navigate('/bc-long');
  scrollTo(0, 1000);
  const going = navigate('/bc-slow');
  await until(() => paint, 'CONTROL: the async component is pending', 4000);
  scrollTo(0, 3000);
  expect(scrollY, 'CONTROL: the page scrolled during the wait').to.equal(3000);
  paint('<p>slow</p>');
  await going;
  expect(location.pathname, 'CONTROL: the slow route committed').to.equal('/bc-slow');
  const back = popped();
  history.back();
  await back();
  await until(() => location.pathname === '/bc-long' && scrollY === 1000, 'Back restores where rendering began (1000), not the scroll during the wait (3000)', 4000);
  el.remove();
});
