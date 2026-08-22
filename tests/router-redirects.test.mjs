/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts, development AND production (see ./dist.mjs), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div></div>', { url: 'http://localhost/A' });
const { window } = dom;
for (const k of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent']) globalThis[k] = window[k];
globalThis.window = window; globalThis.document = window.document;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
const tick = () => new Promise((r) => setTimeout(r, 25));

const { initRouter, navigate } = await load('router');
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

let pushes = 0, replaces = 0;
const oP = window.history.pushState.bind(window.history);
const oR = window.history.replaceState.bind(window.history);
window.history.pushState = (...a) => { pushes++; return oP(...a); };
window.history.replaceState = (...a) => { replaces++; return oR(...a); };

const el = window.document.createElement('div');
const view = window.document.createElement('main');
el.appendChild(view); window.document.body.appendChild(el);
const hits = { A: 0, New: 0, User: 0 };
const r = initRouter(el, { view, focusView: false, handleInitial: false });
r.addRoutes([
  { path: '/A', component: () => { hits.A++; return ''; } },
  { path: '/old', redirect: '/new' },
  { path: '/new', component: () => { hits.New++; return ''; } },
  { path: '/legacy/:id', redirect: (params) => `/user/${params.id}` },
  { path: '/user/:id', component: () => { hits.User++; return ''; } },
  { path: '/loopA', redirect: '/loopB' },
  { path: '/loopB', redirect: '/loopA' },
]);

// 1. string redirect: renders target, one push, URL is target
await navigate('/old', 'navigate'); await tick();
check('string redirect renders target', hits.New === 1);
check('redirect: single entry, target URL', pushes === 1 && window.location.pathname === '/new');

// 2. function redirect with params
await navigate('/legacy/42', 'navigate'); await tick();
check('function redirect maps params', hits.User === 1 && window.location.pathname === '/user/42');

// 3. popstate onto a redirecting path -> replaceState, no push
const p3 = pushes;
window.history.replaceState(null, '', '/old'); const r3 = replaces;
window.dispatchEvent(new window.PopStateEvent('popstate')); await tick();
check('popstate redirect uses replaceState', hits.New === 2 && pushes === p3 && replaces > r3);
check('popstate redirect rewrites URL', window.location.pathname === '/new');

// 4. redirect loop is cut off
const before = { ...hits };
const errs = []; const oe = console.error; console.error = (m) => errs.push(String(m));
await navigate('/loopA', 'navigate'); await tick();
console.error = oe;
check('redirect loop cut off with error', errs.some((m) => m.includes('redirect loop')) &&
  JSON.stringify(hits) === JSON.stringify(before));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
