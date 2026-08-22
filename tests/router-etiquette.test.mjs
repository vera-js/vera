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
const tick = () => new Promise((r) => setTimeout(r, 25));
let scrollCalls = [];
window.scrollTo = (...a) => scrollCalls.push(a);

const { initRouter, navigate } = await load('router');
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

const el = window.document.createElement('div');
const view = window.document.createElement('main');
el.appendChild(view); window.document.body.appendChild(el);
let hits = { A: 0, B: 0, U: 0 }; let lastSnap = null;
const r = initRouter(el, { view, focusView: false, handleInitial: false });
r.addRoutes([
  { path: '/A', component: () => { hits.A++; return ''; } },
  { path: '/B', component: () => { hits.B++; return ''; } },
  { path: '/users', component: (params, to) => { hits.U++; lastSnap = to; return ''; } },
]);

const mkClick = (opts = {}) => new window.MouseEvent('click', { bubbles: true, cancelable: true, ...opts });
const link = window.document.createElement('a');
link.setAttribute('route', ''); link.setAttribute('href', '/B');
el.appendChild(link);

// 1. modified clicks: browser wins (no routing, no preventDefault)
for (const opts of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
  const ev = mkClick(opts); link.dispatchEvent(ev); await tick();
  if (ev.defaultPrevented) { check('modified click not hijacked ' + JSON.stringify(opts), false); }
}
check('modified clicks never routed', hits.B === 0);

// 2. target/download links: browser wins
link.setAttribute('target', '_blank');
const evT = mkClick(); link.dispatchEvent(evT); await tick();
check('target=_blank not hijacked', hits.B === 0 && !evT.defaultPrevented);
link.removeAttribute('target'); link.setAttribute('download', '');
const evD = mkClick(); link.dispatchEvent(evD); await tick();
check('download not hijacked', hits.B === 0 && !evD.defaultPrevented);
link.removeAttribute('download');

// 3. plain click still routes
const evP = mkClick(); link.dispatchEvent(evP); await tick();
check('plain click routes', hits.B === 1 && evP.defaultPrevented);

// 4. query strings: match, ride in URL, exposed on snapshot
await navigate('/users?page=2&tag=x', 'navigate'); await tick();
check('query link matches its route', hits.U === 1);
check('query stays in URL', window.location.search === '?page=2&tag=x' && window.location.pathname === '/users');
check('query parsed on snapshot', lastSnap?.query?.get('page') === '2' && lastSnap?.query?.get('tag') === 'x');

// 5. scroll-to-top on navigate, not on popstate
check('navigate scrolls to top', scrollCalls.some((a) => a[0] === 0 && a[1] === 0));
scrollCalls = [];
window.history.replaceState(null, '', '/B');
window.dispatchEvent(new window.PopStateEvent('popstate')); await tick();
check('popstate restores (top when entry carries no position)', hits.B === 2 && scrollCalls.length === 1 && scrollCalls[0][0] === 0 && scrollCalls[0][1] === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
