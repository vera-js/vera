/**
 * **Two ways nested routing did the wrong thing quietly.**
 *
 * 1. **A nested outlet was never emptied.** A parent's template holds its outlet, and template
 *    identity means re-rendering the parent *reuses* that element rather than rebuilding it — the
 *    renderer working correctly. The outlet's contents were put there by the router on a previous
 *    navigation, not by the template, so they survived: navigating from `/settings/profile` back to
 *    `/settings` re-rendered the parent and left the profile sitting inside it. The page showed a
 *    route that was no longer routed, and only a detour through an unrelated route cleared it,
 *    because that tore the whole subtree down. Every nested app hits this the first time someone
 *    navigates from a child back to its parent.
 *
 * 2. **A nested level inherited an element as its outlet.** `initRouter(el, { view })` accepts an
 *    element for the router's root outlet, and an element is one node — so every level rendered
 *    into the same one and a child silently overwrote its parent. `children`, the feature the whole
 *    nesting design exists for, quietly behaved like a flat route. A *name* inherits fine, because
 *    the search narrows to the level above on each pass.
 *
 * Both produce correct-looking markup, which is why neither had a test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
for (const key of ['HTMLElement', 'Event', 'CustomEvent', 'PopStateEvent', 'MouseEvent', 'Node', 'Element', 'DocumentFragment', 'CSSStyleSheet', 'customElements', 'NodeFilter', 'MutationObserver', 'ShadowRoot'])
  globalThis[key] = dom.window[key];
globalThis.window = dom.window;
globalThis.document = dom.window.document;
dom.window.scrollTo = () => {};

let queued = [];
globalThis.requestAnimationFrame = (fn) => queued.push(fn);
globalThis.cancelAnimationFrame = () => {};
const flush = () => {
  const pending = queued;
  queued = [];
  for (const fn of pending) fn();
};

const { html, wire } = await load('core');
const { renderer } = await load('renderer');
const { initRouter, navigate, router } = await load('router');
wire([renderer, router]);

/** A router per test, since `initRouter` remembers the element it was given. */
let n = 0;
const app = (routes, view) => {
  const element = document.createElement('div');
  element.id = `app-${++n}`;
  element.innerHTML = '<main view="main"></main>';
  document.body.appendChild(element);
  const { addRoutes } = initRouter(element, {
    view: view === 'element' ? element.querySelector('main') : 'main',
    handleInitial: false,
  });
  addRoutes(routes);
  return { element, outlet: element.querySelector('[view="main"]') };
};

const NESTED = [
  {
    path: '/s',
    component: () => html`<section>S<div view="inner"></div></section>`,
    children: [{ path: 'p', view: 'inner', component: () => html`<p>P</p>` }],
  },
  { path: '/other', component: () => html`<p>other</p>` },
];

const go = async (path) => {
  await navigate(path);
  flush();
};

test('a nested outlet is emptied when the route no longer fills it', async () => {
  const { outlet } = app(NESTED);
  await go('/s/p');
  assert.equal(outlet.textContent, 'SP', 'the child renders inside the parent');
  await go('/s');
  assert.equal(outlet.textContent, 'S', 'and is gone when the route no longer has that level');
  await go('/s/p');
  assert.equal(outlet.textContent, 'SP', 'and comes back');
});

test('an outlet the router never painted is left alone', async () => {
  const { element, outlet } = app([
    { path: '/keep', component: () => html`<section>K<div view="mine">owned</div></section>` },
  ]);
  await go('/keep');
  assert.equal(outlet.textContent, 'Kowned', 'a component may mark its own element [view]');
  await go('/keep');
  assert.equal(element.querySelector('[view="mine"]').textContent, 'owned', 'and it is not cleared');
});

test('a nested level does not inherit an element outlet', async () => {
  const { outlet } = app(NESTED, 'element');
  await go('/s/p');
  assert.equal(outlet.textContent, 'SP', 'the child renders into the outlet, not over its parent');
  await go('/s');
  assert.equal(outlet.textContent, 'S');
});

test('a router with no renderer says so, once', async () => {
  /**
   * A **fresh copy** of the module, so its renderer chain is genuinely empty — the one in this file
   * has been wired. This is what an app that wrote `wire([renderer])` and left out `router` gets:
   * every navigation matches, the URL changes, and nothing is ever painted.
   */
  const fresh = await load('router', '?copy=unwired');
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    const element = document.createElement('div');
    element.innerHTML = '<main view="main"></main>';
    document.body.appendChild(element);
    const { addRoutes } = fresh.initRouter(element, { view: 'main', handleInitial: false });
    addRoutes([{ path: '/quiet', component: () => html`<p>q</p>` }]);
    await fresh.navigate('/quiet');
    flush();
    await fresh.navigate('/quiet');
    flush();
  } finally {
    console.warn = warn;
  }
  const about = said.filter((line) => line.includes('nothing is wired to render'));
  assert.equal(about.length, 1, `expected exactly one warning, got ${JSON.stringify(said)}`);
  assert.match(about[0], /^\[vera\] router: /);
  assert.match(about[0], /wire\(\[renderer, router\]\)/, 'and names the fix');
});
