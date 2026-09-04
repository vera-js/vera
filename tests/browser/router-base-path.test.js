import { expect } from '@esm-bundle/chai';
import { initRouter, navigate, setBasePath, setRouterRenderer } from '../../packages/router/dist/development/vera-router.js';

/**
 * **Mounting the app at a subpath, in a real engine.**
 *
 * Two things here are the platform's decisions rather than the router's, and `CLAUDE.md` is explicit
 * that jsdom is the regression net and never the oracle for those:
 *
 * 1. **What a `<base href>` does to relative URL resolution.** The router now resolves a clicked
 *    link through `document.baseURI`, because that is what the browser does — and the whole reason
 *    that change exists is that it had been using `location.href`, which differs precisely when a
 *    `<base>` is present. Asserting the difference under jsdom would be asserting jsdom's opinion of
 *    a rule the engines own.
 * 2. **What `history.pushState` accepts and what `location.pathname` reads back.** The base is added
 *    on the way out and stripped on the way in, so a round trip through real history is the only
 *    thing that shows the two halves agree.
 *
 * The `<base>` element is added and removed per test rather than declared in the page, because it
 * changes resolution for every other URL on the page while it is there — including the module
 * imports the test runner itself is serving.
 */
setRouterRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : '';
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

let made = [];
let hit = null;
afterEach(() => {
  for (const node of made) node.remove();
  made = [];
  setBasePath(null);
});

const makeApp = () => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  made.push(el);
  const router = initRouter(el, { view, handleInitial: false, focusView: false });
  router.addRoutes([
    { path: '/', component: () => ((hit = 'home'), '') },
    { path: '/users', component: () => ((hit = 'users'), '') },
    { path: '/users/:id', component: () => ((hit = 'one user'), '') },
  ]);
  return { el, router };
};

/** Always come from a different route: navigating to the one you are on is a no-op. */
const reset = async () => {
  await navigate('/', 'replace');
  await settle();
  hit = null;
};

it('CONTROL: <base href> changes what the ENGINE resolves a relative link to', () => {
  const base = document.createElement('base');
  base.setAttribute('href', '/app/');
  document.head.appendChild(base);
  try {
    const link = document.createElement('a');
    link.setAttribute('href', 'users');
    expect(new URL(link.getAttribute('href'), document.baseURI).pathname).to.equal('/app/users');
    expect(document.baseURI, 'and baseURI is what moved, not location').to.not.equal(location.href);
  } finally {
    base.remove();
  }
});

it('setBasePath writes the base to history and strips it back off', async () => {
  makeApp();
  setBasePath('/app');
  await reset();

  await navigate('/users', 'navigate');
  await settle();
  expect(location.pathname, 'the real address bar carries the base').to.equal('/app/users');
  expect(hit, 'and the route table, written without it, still matched').to.equal('users');

  /** The round trip: what the engine reads back has to strip to the same route. */
  await navigate('/users/7', 'navigate');
  await settle();
  expect(location.pathname).to.equal('/app/users/7');
  expect(hit).to.equal('one user');

  await navigate('/', 'navigate');
  await settle();
  expect(location.pathname, "the app's own root is the base, no trailing slash").to.equal('/app');
  expect(hit).to.equal('home');
});

it('history traversal under a base routes to the stripped path', async () => {
  makeApp();
  setBasePath('/app');
  await reset();
  await navigate('/users', 'navigate');
  await settle();
  await navigate('/users/7', 'navigate');
  await settle();

  hit = null;
  /**
   * Wait for the EVENT, not for a duration. `history.back()` is asynchronous and how long it takes
   * is the engine's business — a fixed sleep passed in Chromium and WebKit and was short for
   * Firefox, which is the shape of flake this repository has been bitten by before (a recorded
   * value sampled mid-transition). `popstate` fires after the URL has been updated, so it is the
   * condition actually being waited for.
   */
  await new Promise((resolve) => {
    addEventListener('popstate', () => setTimeout(resolve, 60), { once: true });
    history.back();
  });
  expect(location.pathname, 'the engine restored the mounted URL').to.equal('/app/users');
  expect(hit, 'and popstate routed to the route, not to the mounted path').to.equal('users');
});

it('a link whose href carries the base is marked active on the stripped route', async () => {
  const { el } = makeApp();
  setBasePath('/app');
  await reset();

  const link = document.createElement('a');
  link.setAttribute('route', '');
  link.setAttribute('href', '/app/users');
  el.appendChild(link);

  await navigate('/users', 'navigate');
  await settle();
  expect(link.classList.contains('active'), 'the comparison crosses the base').to.equal(true);
  expect(link.getAttribute('aria-current')).to.equal('page');
});
