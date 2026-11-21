import { expect } from '@esm-bundle/chai';
import { initRouter, navigate, setBasePath, setRouterRenderer } from '../../packages/router/dist/development/vera-router.js';
import { until } from './until.js';

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

/**
 * **Routed, waited for**: `navigate` resolves after the route is applied (rendered, history written, `after-route`
 * emitted), so a read after `await navigate(...)` needs no sleep; a navigation the ENGINE starts (a click, a traversal)
 * is waited for through `after-route`. A fixed 60 ms after each read a slow route as the wrong one.
 */
const routed = (router, path) => {
  let arrived = false;
  const seen = (to) => {
    if (to.path === path) arrived = true;
  };
  router.on('after-route', seen);
  return () => until(() => arrived, `after-route for ${path}`, 4000).finally(() => router.off('after-route', seen));
};

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
  expect(location.pathname, 'the real address bar carries the base').to.equal('/app/users');
  expect(hit, 'and the route table, written without it, still matched').to.equal('users');

  /** The round trip: what the engine reads back has to strip to the same route. */
  await navigate('/users/7', 'navigate');
  expect(location.pathname).to.equal('/app/users/7');
  expect(hit).to.equal('one user');

  await navigate('/', 'navigate');
  expect(location.pathname, "the app's own root is the base, no trailing slash").to.equal('/app');
  expect(hit).to.equal('home');
});

it('history traversal under a base routes to the stripped path', async () => {
  const { router } = makeApp();
  setBasePath('/app');
  await reset();
  await navigate('/users', 'navigate');
  await navigate('/users/7', 'navigate');

  hit = null;
  /**
   * Wait for the EVENT, not for a duration. `history.back()` is asynchronous and how long it takes
   * is the engine's business — a fixed sleep passed in Chromium and WebKit and was short for
   * Firefox, which is the shape of flake this repository has been bitten by before (a recorded
   * value sampled mid-transition). The router routes from its own `popstate` listener, and `after-route` for the
   * stripped path is the end of that, so it is the condition actually being waited for (a 60 ms timer after
   * `popstate` was the same guess one step later).
   */
  const back = routed(router, '/users');
  history.back();
  await back();
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
  expect(link.classList.contains('active'), 'the comparison crosses the base').to.equal(true);
  expect(link.getAttribute('aria-current')).to.equal('page');
});

/**
 * The development diagnostic for a routed href written in route space, watched actually firing in
 * a real engine rather than trusted from jsdom. The click is a genuine engine click — dispatched on
 * an anchor the router intercepts — so this also proves interception and the warning share one code
 * path: if the router declined the click for any earlier reason, no warning could fire and the
 * navigation assertion would fail with it.
 */
it('a route-space href is diagnosed in development, once, and still navigates', async () => {
  const { el, router } = makeApp();
  setBasePath('/app');
  await reset();

  const said = [];
  const original = console.warn;
  console.warn = (...args) => {
    said.push(args.join(' '));
    original.apply(console, args);
  };
  try {
    const link = document.createElement('a');
    link.setAttribute('route', '');
    link.setAttribute('href', '/users');
    el.appendChild(link);
    /** The warning is printed synchronously in the click handler, before it navigates: read at once after each click. */
    const arrived = routed(router, '/users');
    link.click();
    await arrived();
    expect(location.pathname, 'the click still navigates — the diagnosis is advice, not a refusal')
      .to.equal('/app/users');
    link.click();
    expect(said.filter((line) => line.includes('points outside')).length, 'the second click of the same href added none').to.equal(1);
    /** CONTROL: another route-space href warns at its own click, synchronously, so the read above could have seen one. */
    const other = document.createElement('a');
    other.setAttribute('route', '');
    other.setAttribute('href', '/users/7');
    el.appendChild(other);
    const arrivedOther = routed(router, '/users/7');
    other.click();
    expect(said.filter((line) => line.includes('points outside')).length, 'CONTROL: a new href warns at once').to.equal(2);
    await arrivedOther();
  } finally {
    console.warn = original;
  }

  const warnings = said.filter((line) => line.includes('points outside'));
  expect(warnings.length, 'one warning for two clicks of the same href, one for the other').to.equal(2);
  expect(warnings[0]).to.include('[vera]');
  expect(warnings[0], 'and it names the href the author should have written').to.include('/app/users');
});
