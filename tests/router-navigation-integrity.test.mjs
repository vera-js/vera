/**
 * The five defects the router audit found, each pinned so it cannot come back.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs). Plain pass/fail script under
 * node --test: a nonzero exit marks the file failed.
 */
import { load } from './dist.mjs';
import { JSDOM, VirtualConsole } from 'jsdom';

/** jsdom has no scrollTo and reports the miss as an uncaught error; the router's use of it is fine. */
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});
const dom = new JSDOM('<div></div>', { url: 'http://localhost/start', virtualConsole });
const { window } = dom;
window.scrollTo = () => {};
for (const k of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent', 'Element'])
  globalThis[k] = window[k];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = () => {};

const { initRouter, navigate, setRouterRenderer } = await load('router');
setRouterRenderer((template, view) => { view.textContent = String(template); });

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => (cond ? pass++ : (fail++, console.log('FAIL:', name, extra)));

const app = (routes, options = {}) => {
  const element = window.document.createElement('div');
  const view = window.document.createElement('main');
  view.setAttribute('view', 'main');
  element.appendChild(view);
  window.document.body.appendChild(element);
  const router = initRouter(element, { view: 'main', focusView: false, handleInitial: false, ...options });
  router.addRoutes(routes);
  return { element, router, view };
};

// ── a newer navigation supersedes an older one ────────────────────────────────────────────────
/**
 * The user clicks a route whose component fetches, changes their mind, and clicks a fast one.
 * Without supersession the slow pass finishes last and wins: the app lands on the route the user
 * abandoned, in both the view and the URL, with no error anywhere.
 */
{
  const { view } = app([
    { path: '/slow', component: async () => { await new Promise((r) => setTimeout(r, 50)); return 'SLOW'; } },
    { path: '/fast', component: () => 'FAST' },
  ]);
  const first = navigate('/slow', 'navigate');
  await new Promise((r) => setTimeout(r, 5));
  const second = navigate('/fast', 'navigate');
  await Promise.all([first, second]);
  await new Promise((r) => setTimeout(r, 80));
  check('the last click wins the view', view.textContent === 'FAST', view.textContent);
  check('the last click wins the URL', window.location.pathname === '/fast', window.location.pathname);
}

/** A guard is an await too, so the same race runs through `before-route`. */
{
  const { view, router } = app([
    { path: '/guarded', component: () => 'GUARDED' },
    { path: '/plain', component: () => 'PLAIN' },
  ]);
  router.on('before-route', async (to) => {
    if (to.path === '/guarded') await new Promise((r) => setTimeout(r, 50));
    return true;
  });
  const first = navigate('/guarded', 'navigate');
  await new Promise((r) => setTimeout(r, 5));
  await Promise.all([first, navigate('/plain', 'navigate')]);
  await new Promise((r) => setTimeout(r, 80));
  check('a slow guard cannot resurrect its navigation', view.textContent === 'PLAIN', view.textContent);
}

// ── params are percent-decoded ────────────────────────────────────────────────────────────────
{
  let name, rest;
  app([
    { path: '/u/:name', component: (p) => { name = p.name; return ''; } },
    { path: '/w/*rest', component: (p) => { rest = p.rest; return ''; } },
  ]);
  await navigate('/u/John%20Doe', 'navigate');
  check('a space in a param', name === 'John Doe', name);
  await navigate('/u/caf%C3%A9', 'navigate');
  check('utf-8 in a param', name === 'café', name);
  await navigate('/w/a%20b/c', 'navigate');
  check('wildcard segments decode individually', JSON.stringify(rest) === '["a b","c"]', JSON.stringify(rest));

  /** A URL a person can type by hand must not throw out of routing. */
  await navigate('/u/100%', 'navigate');
  check('a malformed escape yields the raw text', name === '100%', name);
}

// ── route events reach the router element, and can cancel ─────────────────────────────────────
{
  let onElement = 0, onDocument = 0;
  const { element } = app([{ path: '/ev', component: () => '' }]);
  element.addEventListener('vera:before-route', () => onElement++);
  window.document.addEventListener('vera:before-route', () => onDocument++);
  await navigate('/ev', 'navigate');
  check('a listener on the router element fires', onElement === 1, `${onElement}`);
  check('and it still bubbles to document', onDocument === 1, `${onDocument}`);
}

{
  let ran = 0;
  const { element } = app([{ path: '/ev2', component: () => { ran++; return ''; } }]);
  element.addEventListener('vera:before-route', (e) => e.preventDefault());
  await navigate('/ev2', 'navigate');
  check('preventDefault() cancels the navigation', ran === 0, `component ran ${ran}x`);
}

/** The handler API is the other half of the same contract and must be unaffected. */
{
  let ran = 0;
  const { router } = app([{ path: '/g', component: () => { ran++; return ''; } }]);
  router.on('before-route', () => false);
  await navigate('/g', 'navigate');
  check('a handler returning false still cancels', ran === 0, `component ran ${ran}x`);
}

// ── navigate() defaults to a real navigation ──────────────────────────────────────────────────
/**
 * TypeScript required the trigger; plain JS — a first-class consumption mode — did not, and
 * omitting it routed the view while silently leaving the URL behind.
 */
{
  app([{ path: '/no-trigger', component: () => '' }]);
  await navigate('/no-trigger');
  check('navigate(path) moves the URL', window.location.pathname === '/no-trigger', window.location.pathname);
}

// ── a route is matched once per navigation, not twice ─────────────────────────────────────────
/**
 * `getRoute` ran in the redirect scan and again while routing, discarding the first result. For a
 * `path` function that meant calling it — and recompiling its pattern — twice on every navigation.
 */
{
  let compiles = 0;
  app([{ path: () => { compiles++; return '/fn'; }, component: () => '' }]);
  await navigate('/fn', 'navigate');
  await navigate('/elsewhere', 'navigate');
  await navigate('/fn-again', 'navigate');
  check('a path function is called once per navigation', compiles === 3, `${compiles} calls for 3`);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
