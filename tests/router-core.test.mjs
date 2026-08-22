/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts, development AND production (see ./dist.mjs), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
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

const { initRouter, navigate } = await load('router');

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

let pushes = 0;
const origPush = window.history.pushState.bind(window.history);
window.history.pushState = (...a) => { pushes++; return origPush(...a); };

const makeApp = () => {
  const el = window.document.createElement('div');
  const view = window.document.createElement('main');
  el.appendChild(view); window.document.body.appendChild(el);
  const hits = { A: 0, B: 0, F: 0 };
  const r = initRouter(el, { view, focusView: false, handleInitial: false });
  r.addRoutes([
    { path: '/A', component: () => { hits.A++; return ''; } },
    { path: '/B', component: () => { hits.B++; return ''; } },
    { path: '/file.html', component: () => { hits.F++; return ''; } },
  ]);
  return { el, r, hits };
};
const app1 = makeApp();
const app2 = makeApp();

// 1. init: routes, but writes NO history entry
const app3el = window.document.createElement('div');
const app3view = window.document.createElement('main');
app3el.appendChild(app3view); window.document.body.appendChild(app3el);
let initHits = 0;
const r3 = initRouter(app3el, { view: app3view, focusView: false });
r3.addRoutes([{ path: '/A', component: () => { initHits++; return ''; } }]);
flushRaf(); await tick();
check('init routes without pushState', initHits === 1 && pushes === 0);
check('init also routed the sibling routers (shared URL)', app1.hits.A === 1 && app2.hits.A === 1);

// 2. link navigation routes ALL routers, one history entry
const link = window.document.createElement('a');
link.setAttribute('route', ''); link.setAttribute('href', '/B');
app1.el.appendChild(link);
link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await tick();
check('navigate routes all routers', app1.hits.B === 1 && app2.hits.B === 1);
check('navigate writes exactly one entry', pushes === 1);

// 3. browser Back: no pushState, all routers follow
window.history.replaceState(null, '', '/A');
window.dispatchEvent(new window.PopStateEvent('popstate'));
await tick();
check('popstate: no pushState', pushes === 1);
check('popstate routes all routers', app1.hits.A === 2 && app2.hits.A === 2);

// 4. repeated addRoutes: still ONE click listener (one route per click)
app1.r.addRoutes([{ path: '/extra', component: () => '' }]);
app1.r.addRoutes([{ path: '/extra2', component: () => '' }]);
link.setAttribute('href', '/B');
link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await tick();
check('repeated addRoutes: single listener, single route', app1.hits.B === 2 && app2.hits.B === 2);

// 5. metacharacter escaping: /file.html must not match /fileXhtml
await navigate('/fileXhtml', 'navigate');
check('dot no longer matches any char', app1.hits.F === 0);
await navigate('/file.html', 'navigate');
check('literal path still matches', app1.hits.F === 1);

// 6. programmatic navigate is public API
await navigate('/A', 'navigate');
check('programmatic navigate works', app1.hits.A === 3);

// 7. active link: trailing-slash href matches stripped path
const slashLink = window.document.createElement('a');
slashLink.setAttribute('route', ''); slashLink.setAttribute('href', '/B/');
app1.el.appendChild(slashLink);
await navigate('/B', 'navigate');
check('href="/B/" marked active for /B', slashLink.getAttribute('aria-current') === 'page');

// 8. deleteRouter: listener gone, no further routing
const before = app1.hits.A;
app1.r.deleteRouter();
await navigate('/A', 'navigate');
check('deleted router no longer routes (sibling still does)', app1.hits.A === before && app2.hits.A === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
