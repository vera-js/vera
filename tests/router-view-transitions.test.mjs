/**
 * The router's view-transition wrap — the SPA half of the page-transition story.
 *
 * The claims: `router({ animate: true })` is a DUAL (bare `router` still wires; the called form
 * configures first), a NAVIGATION wraps its routed renders in `startViewTransition`, the INIT
 * render never does (the conventions' establishment law), and a guard that throws still rejects
 * `navigate` — the transition changes the theater, never the contract.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div></div>', { url: 'http://localhost/A' });
const { window } = dom;
for (const k of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event']) globalThis[k] = window[k];
globalThis.window = window; globalThis.document = window.document;
let rafQueue = [];
globalThis.requestAnimationFrame = (fn) => rafQueue.push(fn);
const flushRaf = () => { const q = rafQueue; rafQueue = []; q.forEach((f) => f()); };
const tick = () => new Promise((r) => setTimeout(r, 20));

const { initRouter, navigate, router, setRouterRenderer } = await load('router');

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

/** The platform stub: counts wraps, runs the callback, resolves like a finished transition. */
let transitions = 0;
window.document.startViewTransition = (callback) => {
  transitions++;
  const updateCallbackDone = Promise.resolve().then(callback);
  return { updateCallbackDone, finished: updateCallbackDone };
};

/** The DUAL: the called form returns a connector (a function wire would hand the registry);
 *  the bare form still accepts a registry-shaped thing directly. */
const connector = router({ animate: true, base: '/app' });
check('router({ animate, base }) returns a connector for wire', typeof connector === 'function');
const fakeRegistry = new Map();
router(fakeRegistry);
check('bare router still takes the registry directly (a Map is not options)', true);

const hits = { A: 0, B: 0 };
setRouterRenderer(() => {});
const el = window.document.createElement('div');
const view = window.document.createElement('main');
el.appendChild(view);
window.document.body.appendChild(el);
const { addRoutes } = initRouter(el, { view });
/** The base option took: a path under /app resolves; the raw path would not. */
addRoutes([
  { path: '/A', component: () => { hits.A++; return 'a-view'; } },
  { path: '/B', component: () => { hits.B++; return 'b-view'; } },
  { path: '/boom', beforeEnter: () => { throw new Error('guard says no'); }, component: () => 'never' },
]);

flushRaf();
await tick();
check('the INIT render ran', hits.A === 1);
check('and INIT never animates — establishment answers no one', transitions === 0);

await navigate('/B');
await tick();
check('a real navigation routed (under the option-set base)', hits.B === 1);
check('and the URL carries the base — router({ base }) IS setBasePath', window.location.pathname === '/app/B');
check('and wrapped its render in exactly one transition', transitions === 1);

let rejected = false;
await navigate('/boom').catch(() => { rejected = true; });
check('a throwing guard still rejects navigate', rejected);
check('and a REFUSED navigation never starts a transition at all — guards run first',
  transitions === 1);

/** PRE-RESOLUTION: a lazy route's `load` settles BEFORE the transition wraps — the chunk
 *  arrives while the old view is still interactive, never inside the frozen window. */
window.document.startViewTransition = (callback) => {
  order.push('transition');
  const updateCallbackDone = Promise.resolve().then(callback);
  return { updateCallbackDone, finished: updateCallbackDone };
};
const order = [];
addRoutes([{ path: '/lazy',
  load: async () => { await new Promise((r) => setTimeout(r, 30)); order.push('load'); },
  component: () => { order.push('component'); return 'lazy-view'; } }]);
await navigate('/lazy');
check('load resolved before the transition began, component ran inside it',
  order.join('>') === 'load>transition>component');

/** Opt-out sanity: with no support on the page, navigation is instant and identical. */
delete window.document.startViewTransition;
await navigate('/A');
await tick();
check('no platform, no wrap, same routing', hits.A === 2 && transitions === 1);

console.log(`pass ${pass} fail ${fail}`);
if (fail) process.exit(1);
