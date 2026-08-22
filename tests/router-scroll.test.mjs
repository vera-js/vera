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
Object.defineProperty(window, 'scrollX', { value: 0, configurable: true });
Object.defineProperty(window, 'scrollY', { value: 150, configurable: true });  // user is mid-page

const { initRouter, navigate } = await load('router');
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

let savedStates = [];
const oR = window.history.replaceState.bind(window.history);
window.history.replaceState = (s, t, u) => { savedStates.push(s); return oR(s, t, u); };

const el = window.document.createElement('div');
const view = window.document.createElement('main');
el.appendChild(view); window.document.body.appendChild(el);
const r = initRouter(el, { view, focusView: false, handleInitial: false });
r.addRoutes([{ path: '/A', component: () => '' }, { path: '/B', component: () => '' }]);

// 1. navigating away stamps the scroll position onto the entry being left
await navigate('/B', 'navigate'); await tick();
check('scroll stamped on departure', savedStates.some((s) => s?.scroll?.[1] === 150));

// 2. traversing back restores it after routing
scrollCalls = [];
window.history.replaceState(null, '', '/A');
window.dispatchEvent(new window.PopStateEvent('popstate', { state: { scroll: [0, 150] } })); await tick();
check('popstate restores stamped position', scrollCalls.some((a) => a[0] === 0 && a[1] === 150));

// 3. entry without a stamp lands at top
scrollCalls = [];
window.history.replaceState(null, '', '/B');
window.dispatchEvent(new window.PopStateEvent('popstate')); await tick();
check('unstamped entry lands at top', scrollCalls.some((a) => a[0] === 0 && a[1] === 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
