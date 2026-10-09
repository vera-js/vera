/**
 * **The router's diagnostics by code** (code-system phase 2, 2026-10-09) — and the promises the docs-claims pass found
 * true but unpinned: a nested route with no outlet (both variants, one code), two routes with one name, an unknown
 * name, and the open-redirect guard pinned by BEHAVIOR in every build (vera-5a), so a later byte-hunting pass cannot
 * fold the refusal together with its development message.
 */
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/start', pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'Event', 'CustomEvent', 'PopStateEvent', 'MouseEvent', 'customElements']) globalThis[k] = dom.window[k];
globalThis.window = dom.window;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;

const router = await load('router');
const { initRouter, navigate } = router;
router.setRouterRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : '';
});

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { cond ? pass++ : (fail++, console.log('FAIL:', name, detail)); };
const capture = async (run) => {
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(String(args[0]));
  try { await run(); } finally { console.warn = warn; }
  return said;
};
const coded = (said, code) => said.filter((line) => line.endsWith(`(${code})`));

/** The open-redirect guard: refused in EVERY build; the development line names it by code. */
{
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  const r = initRouter(el, { view, focusView: false, handleInitial: false });
  r.addRoutes([{ path: '/start', component: () => 'start' }, { path: '/*rest', component: () => 'any' }]);
  await navigate('/start');
  const before = location.href;
  let results;
  const said = await capture(async () => {
    results = [await navigate('//evil.example/x'), await navigate('https://evil.example/y')];
  });
  check('cross-origin: both refused, in every build', results[0] === false && results[1] === false, JSON.stringify(results));
  check('cross-origin: the URL did not move', location.href === before, location.href);
  const lines = coded(said, 'router-cross-origin');
  if (isProduction) check('cross-origin: production says nothing (the guard is not the message)', said.length === 0, said.join(' | '));
  else {
    check('cross-origin: both named by one code', lines.length === 2, said.join(' | '));
    /** Here the base resolves, so both take the "resolves to another origin" branch; the "names an origin" branch needs
     *  a base that cannot resolve one (about:blank) — the same code and fix, the variant only in the sentence. */
    check('cross-origin: each names the foreign origin', lines.every((line) => /resolves to (http|https):\/\/evil\.example/.test(line)), lines.join(' | '));
  }
}

/** A nested route with no outlet — both variants, one code. */
{
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  const r = initRouter(el, { view, focusView: false, handleInitial: false });
  r.addRoutes([
    { path: '/n-parent', component: () => '<p>no outlet here</p>', children: [{ path: 'child', component: () => 'C' }] },
    { path: '/n-named', component: () => '<p>none</p>', children: [{ path: 'kid', view: 'side', component: () => 'K' }] },
  ]);
  const elementVariant = coded(await capture(() => navigate('/n-parent/child')), 'router-no-outlet');
  const namedVariant = coded(await capture(() => navigate('/n-named/kid')), 'router-no-outlet');
  if (isProduction) check('no-outlet: production says nothing', elementVariant.length + namedVariant.length === 0);
  else {
    check('no-outlet: the element-rooted variant, by code', elementVariant.length === 1 && /given its root outlet as an element/.test(elementVariant[0]), elementVariant.join(' | '));
    check('no-outlet: the missing [view] variant, by code', namedVariant.length === 1 && /no \[view="side"\] was found there/.test(namedVariant[0]), namedVariant.join(' | '));
  }
}

/** Two routes with one name; an unknown name. */
{
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  const r = initRouter(el, { view, focusView: false, handleInitial: false });
  const duplicate = coded(await capture(() => r.addRoutes([{ path: '/d-one', name: 'twice' }, { path: '/d-two', name: 'twice' }])), 'router-duplicate-name');
  const unknown = coded(await capture(() => { check('unknown name: resolve answers ""', router.resolve('no-such-route') === ''); }), 'router-unknown-name');
  if (isProduction) check('names: production says nothing', duplicate.length + unknown.length === 0);
  else {
    check('duplicate-name: by code, naming both paths', duplicate.length === 1 && /"\/d-one" and "\/d-two"/.test(duplicate[0]), duplicate.join(' | '));
    check('unknown-name: by code', unknown.length === 1 && /no route is named "no-such-route"/.test(unknown[0]), unknown.join(' | '));
  }
}

/** navigate's target is a path or { name, params } — a function is a route-definition shape, refused here. */
if (!isProduction) {
  let message = '';
  try { await navigate(() => '/x'); } catch (error) { message = error.message; }
  check('navigate(function): refused by code', /^navigate: expected a path or a \{ name, params \} object[\s\S]*\(router-navigate-target\)$/.test(message), message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
