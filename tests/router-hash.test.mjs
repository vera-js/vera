/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts (dist/development), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div></div>', { url: 'http://localhost/A' });
const { window } = dom;
for (const k of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event']) globalThis[k] = window[k];
globalThis.window = window; globalThis.document = window.document;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
const tick = () => new Promise((r) => setTimeout(r, 30));

let scrolled = [];
window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };

const { initRouter, navigate } = await import(new URL('../packages/router/dist/development/vera-router.js', import.meta.url).href);
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

let pushes = 0, replaces = 0, hashFn = [];
const oP = window.history.pushState.bind(window.history);
const oR = window.history.replaceState.bind(window.history);
window.history.pushState = (...a) => { pushes++; return oP(...a); };
window.history.replaceState = (...a) => { replaces++; return oR(...a); };

const el = window.document.createElement('div');
const view = window.document.createElement('main');
el.appendChild(view); window.document.body.appendChild(el);
const r = initRouter(el, { view, focusView: false, handleInitial: false, hashChangeFunction: (h) => hashFn.push(h) });
r.addRoutes([
  { path: '/A', component: () => '' },
  { path: '/B', component: () => '<h2 id="sec">s</h2>' },
]);
// render inserts chain is empty (no core) — put the anchor target in the view manually
const anchor = window.document.createElement('h2'); anchor.id = 'sec'; view.appendChild(anchor);

// 1. path+hash navigate: ONE entry total, hash lands in URL
await navigate('/B#sec', 'navigate'); await tick();
check('one pushState for path+hash', pushes === 1);
check('fragment in final URL', window.location.hash === '#sec' && window.location.pathname === '/B');
check('hashChangeFunction called exactly once', hashFn.length === 1 && hashFn[0] === '#sec');

// 2. hash-only navigate: native assignment, single fn call
hashFn = [];
await navigate('/B#other', 'navigate'); await tick();
check('hash-only: no extra pushState', pushes === 1);
check('hash-only: fn once', hashFn.length === 1 && hashFn[0] === '#other');
check('hash-only: URL updated', window.location.hash === '#other');

// 3. replace trigger: replaceState, no push
hashFn = [];
await navigate('/A', 'replace'); await tick();
check('replace uses replaceState', pushes === 1 && replaces >= 1 && window.location.pathname === '/A');

// 4. init with hash: scrolls to anchor after render, fn called, no history writes
const p2 = pushes, r2 = replaces; hashFn = []; scrolled = [];
window.history.replaceState(null, '', '/B#sec');
const el2 = window.document.createElement('div');
const view2 = window.document.createElement('main');
const anchor2 = window.document.createElement('h2'); anchor2.id = 'sec'; view2.appendChild(anchor2);
el2.appendChild(view2); window.document.body.appendChild(el2);
// reset currentPath tracking by navigating state to something else first is not possible from outside;
// init dedupe: currentPath is '/A', location now '/B#sec' -> differs, so init routes
const rr = initRouter(el2, { view: view2, focusView: false });
rr.addRoutes([{ path: '/B', component: () => '' }]);
await tick(); await tick();
check('init: no history writes', pushes === p2 && replaces === r2 + 1); // +1 is our own test replaceState
check('init: scrolled to deep-linked anchor', scrolled.includes('sec'));
check('init: fn called once', hashFn.length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
