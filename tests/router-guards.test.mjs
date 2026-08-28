/**
 * Route guards and focus management — the router behaviour the 2026-08-22 audit found untested.
 *
 * The router sat at 78% functions, and the uncovered ranges mapped to two real features: a handler
 * returning `false` cancels a navigation, and `focusView` moves focus into the newly routed view.
 * The second is accessibility behaviour, on by default, with no coverage at all.
 *
 * Tests the BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'PopStateEvent', 'MouseEvent', 'customElements']) globalThis[k] = dom.window[k];
globalThis.window = dom.window;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;

const router = await load('router');
const { initRouter, navigate } = router;

/**
 * The router hands a component's return value to a renderer — it does not touch the DOM itself.
 * With none set the view stays empty and `focusView` has no first child to focus.
 *
 * Handed straight to the router. This used to read "register through `router.setRenderer`, NOT
 * through a separately loaded `@verajs/inserts`, because those are different registry objects and
 * the standalone copy writes to a map the router never reads" — a hazard that was verified, silent,
 * and is now impossible: the router imports no registry, so there is no wrong one to pick.
 */
router.setRouterRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : '';
});

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

const makeApp = (routes) => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  const r = initRouter(el, { view, focusView: false, handleInitial: false });
  r.addRoutes(routes);
  return { el, view, r };
};

// 1-3. before-route can cancel a navigation by returning false
{
  const hits = { a: 0, b: 0 };
  const app = makeApp([
    { path: '/g-a', component: () => { hits.a++; return '<p>A</p>'; } },
    { path: '/g-b', component: () => { hits.b++; return '<p>B</p>'; } },
  ]);

  await navigate('/g-a');
  check('guard: baseline navigation works', hits.a === 1);

  let seenTo;
  const block = (to) => { seenTo = to; return false; };
  app.r.on('before-route', block);
  await navigate('/g-b');
  check('guard: returning false cancels the navigation', hits.b === 0);
  check('guard: the handler received the target route', seenTo?.path === '/g-b');

  // 4. removing the handler restores navigation
  app.r.off('before-route', block);
  await navigate('/g-b');
  check('guard: off() restores navigation', hits.b === 1);
}

// 5-6. a handler that returns anything else does NOT cancel
{
  const hits = { c: 0 };
  const app = makeApp([{ path: '/g-c', component: () => { hits.c++; return '<p>C</p>'; } }]);
  let called = 0;
  app.r.on('before-route', () => { called++; return undefined; });
  await navigate('/g-c');
  check('guard: undefined does not cancel', hits.c === 1);
  check('guard: the handler still ran', called === 1);
}

// 7. an async guard is awaited before the route is applied
{
  const hits = { d: 0 };
  const app = makeApp([{ path: '/g-d', component: () => { hits.d++; return '<p>D</p>'; } }]);
  app.r.on('before-route', async () => {
    await new Promise((r) => setTimeout(r, 10));
    return false;
  });
  await navigate('/g-d');
  check('guard: an async handler returning false still cancels', hits.d === 0);
}

// 8. after-route fires but cannot cancel — the navigation already happened
{
  const hits = { e: 0 };
  const app = makeApp([{ path: '/g-e', component: () => { hits.e++; return '<p>E</p>'; } }]);
  let after = 0;
  app.r.on('after-route', () => { after++; return false; });
  await navigate('/g-e');
  check('after-route fires and cannot cancel', hits.e === 1 && after === 1);
}

// 9-12. focusView moves focus into the newly routed view
//
// Two things gate this, and both are easy to get wrong:
//
//   1. The click handler ignores any link without a `route` attribute — that opt-in is what keeps
//      ordinary links behaving like links.
//   2. `shouldFocusView = element === origin || trigger === 'popstate'`, so focus follows USER
//      navigation only. A programmatic `navigate()` deliberately leaves focus alone rather than
//      fighting a caller who has just focused something.
{
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  const r = initRouter(el, { view, focusView: true, handleInitial: false });
  r.addRoutes([
    { path: '/f-input', component: () => '<section><input id="target"><button>b</button></section>' },
    { path: '/f-plain', component: () => '<section id="plain">no focusable children</section>' },
  ]);

  const clickTo = async (href) => {
    const link = document.createElement('a');
    link.href = href;
    link.setAttribute('route', '');
    el.appendChild(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((res) => setTimeout(res, 30));
  };

  await clickTo('/f-input');
  check('focusView: focus lands on the first focusable element', document.activeElement?.id === 'target');

  await clickTo('/f-plain');
  const focused = document.activeElement;
  check('focusView: with nothing focusable, the view root takes focus', focused?.id === 'plain');
  /**
   * `-1`, not `0`. Both take focus from script; only `0` also inserts the element into the tab
   * sequence, and nothing ever takes it back out — so routing to a view with no focusable content
   * used to leave a new tab stop on the page each time.
   */
  check('focusView: made focusable without joining the tab order', focused?.tabIndex === -1);

  check('a link without the route attribute is left to the browser', (() => {
    const plain = document.createElement('a');
    plain.href = '/f-input';
    el.appendChild(plain);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    plain.dispatchEvent(ev);
    return !ev.defaultPrevented;
  })());
}

// 13. a programmatic navigate does NOT move focus, by design
{
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  const outside = document.createElement('input');
  document.body.appendChild(outside);
  const r = initRouter(el, { view, focusView: true, handleInitial: false });
  r.addRoutes([{ path: '/f-prog', component: () => '<section><input id="prog"></section>' }]);
  outside.focus();
  await navigate('/f-prog');
  check('programmatic navigate leaves focus alone even with focusView on', document.activeElement === outside);
  check('but it did route', view.querySelector('#prog') !== null);
}

/**
 * **Only `false` cancels**, and a guard returning a path is the Vue Router habit — there,
 * `beforeEnter: () => '/login'` redirects. Here a string is truthy, so the route it was guarding
 * renders anyway; in an auth guard that is the guard defeated, silently.
 *
 * Warned rather than obeyed: making a returned string redirect would be a second way to do what the
 * `redirect` route option already does, and the two would disagree the moment both were set.
 */
{
  /** The warning is `__DEV__`-only, so production has nothing to observe — see dist.mjs. */
  const said = [];
  const realWarn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  makeApp([{ path: '/redirecting-guard', component: () => '<p>guarded</p>', beforeEnter: () => '/elsewhere' }]);
  await navigate('/redirecting-guard');
  console.warn = realWarn;

  const warning = said.find((line) => line.includes('beforeEnter'));
  if (isProduction) {
    check('production says nothing about a guard returning a path', !warning, warning ?? '');
  } else {
    check('a guard returning a path is warned about', !!warning, said.join(' | ') || '(nothing said)');
    check('and the warning names the redirect option', !!warning && warning.includes('`redirect` route option'), warning ?? '');
    check('and carries the [vera] prefix', !!warning && warning.startsWith('[vera]'), warning ?? '');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
