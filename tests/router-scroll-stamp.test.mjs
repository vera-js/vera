/**
 * Born-stamped entries: every entry the router pushes is born with the state `0` (at the top), and leaving one rewrites
 * its stamp only when it was scrolled. What a traversal reads must be what it read when every leave was stamped:
 * `[0, 0]` for an entry the user never scrolled, the real offset for one they did, and the landing entry (which the
 * router did not push) stamped on the first navigation. Counted: one history call to navigate on from an unscrolled
 * router entry, two otherwise (a scrolled leave is always stamped). Tests BUILT artifacts, development AND production.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div></div>', { url: 'http://localhost/A' });
const { window } = dom;
for (const k of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent']) globalThis[k] = window[k];
globalThis.window = window; globalThis.document = window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));

let y = 0;
Object.defineProperty(window, 'scrollX', { get: () => 0, configurable: true });
Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true });
let scrolled = [];
window.scrollTo = (...a) => { scrolled.push(a); y = a[1] ?? 0; };

const { initRouter, navigate } = await load('router');
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { cond ? pass++ : (fail++, console.log('FAIL:', name, detail)); };

let calls = [];
const realPush = window.history.pushState.bind(window.history);
const realReplace = window.history.replaceState.bind(window.history);
window.history.pushState = (s, t, u) => { calls.push(['push', s, u]); return realPush(s, t, u); };
window.history.replaceState = (s, t, u) => { calls.push(['replace', s, u]); return realReplace(s, t, u); };

const seen = [];
const el = window.document.createElement('div');
const view = window.document.createElement('main');
el.appendChild(view); window.document.body.appendChild(el);
initRouter(el, { view, focusView: false, handleInitial: false, scrollBehavior: (to, saved) => seen.push(saved) })
  .addRoutes([{ path: '/A', component: () => '' }, { path: '/B', component: () => '' }, { path: '/C', component: () => '' }]);
/** Back, as the browser does it: the entry it lands on, with that entry's own state on the `popstate`. */
const back = async (url, state) => {
  realReplace(state, '', url);
  window.dispatchEvent(new window.PopStateEvent('popstate', { state }));
  await tick();
};

// 1. The landing entry (state null, not pushed by the router) is stamped on the first navigation, as before.
calls = [];
await navigate('/B'); await tick();
check('landing: stamped on leaving', calls[0]?.[0] === 'replace' && calls[0][1]?.scroll?.[1] === 0, JSON.stringify(calls));
check('landing: the new entry is born stamped at the top', calls[1]?.[0] === 'push' && calls[1][1] === 0, JSON.stringify(calls));

// 2. Leaving an unscrolled router entry: ONE call (the push), and Back to it reads [0, 0] (its birth stamp), as it
//    read when every leave was stamped: the born state `0` is read as [0, 0].
calls = [];
await navigate('/C'); await tick();
check('unscrolled: one history call', calls.length === 1 && calls[0][0] === 'push', JSON.stringify(calls));
seen.length = 0;
await back('/B', 0); // /B was born 0 (row 1)
check('unscrolled: Back reads [0, 0]', seen.length === 1 && seen[0]?.[0] === 0 && seen[0]?.[1] === 0, JSON.stringify(seen));

// 3. A scrolled router entry is stamped with its real offset on leaving, and Back restores it.
y = 420;
calls = [];
await navigate('/C'); await tick();
check('scrolled: stamped on leaving', calls.length === 2 && calls[0][0] === 'replace' && calls[0][1]?.scroll?.[1] === 420, JSON.stringify(calls));
seen.length = 0;
await back('/B', calls[0][1]);
check('scrolled: Back restores the offset', seen.length === 1 && seen[0]?.[1] === 420, JSON.stringify(seen));

// 4. A scrolled leave is always stamped, even at the offset its entry already carries (the state is never read there).
y = 420;
calls = [];
await navigate('/A'); await tick();
check('scrolled to its stamp: stamped again', calls.length === 2 && calls[0][0] === 'replace' && calls[0][1]?.scroll?.[1] === 420, JSON.stringify(calls));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
