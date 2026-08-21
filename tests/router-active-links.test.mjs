/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts (dist/development), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div></div>', { url: 'http://localhost/A' });
const { window } = dom;
for (const k of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent']) globalThis[k] = window[k];
globalThis.window = window; globalThis.document = window.document;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
const tick = () => new Promise((r) => setTimeout(r, 25));

const { initRouter, navigate } = await import(new URL('../packages/router/dist/development/vera-router.js', import.meta.url).href);
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

const el = window.document.createElement('div');
const view = window.document.createElement('main');
el.appendChild(view); window.document.body.appendChild(el);
const r = initRouter(el, { view, focusView: false, handleInitial: false });
r.addRoutes([
  { path: '/A', component: () => '' },
  { path: '/users', component: () => '' },
  { path: '/users/:id', component: () => '' },
  { path: '/user', component: () => '' },
]);
const mkLink = (href) => {
  const a = window.document.createElement('a');
  a.setAttribute('route', ''); a.setAttribute('href', href);
  el.appendChild(a); return a;
};
const root = mkLink('/'), users = mkLink('/users'), user5 = mkLink('/users/5?tab=x'), user = mkLink('/user');

await navigate('/users/5', 'navigate'); await tick();
check('exact: active + aria-current (query-tolerant href)', user5.classList.contains('active') && user5.getAttribute('aria-current') === 'page');
check('ancestor gets active-within', users.classList.contains('active-within') && !users.classList.contains('active'));
check('segment boundary respected (/user vs /users)', !user.classList.contains('active-within') && !user.classList.contains('active'));
check('root link not lit as ancestor', !root.classList.contains('active-within'));

await navigate('/users', 'navigate'); await tick();
check('exact on ancestor page', users.classList.contains('active') && users.getAttribute('aria-current') === 'page' && !users.classList.contains('active-within'));
check('deeper link cleared', !user5.classList.contains('active') && !user5.getAttribute('aria-current'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
