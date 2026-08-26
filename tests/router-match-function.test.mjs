/**
 * **`setMatchFunction` claims path-to-regexp "drops straight in." This checks the contract.**
 *
 * The library is not a dependency of this repo and should not become one to prove a sentence in a
 * README, so what is asserted here is the *shape* path-to-regexp documents: `match(pattern)` returns
 * a function from a pathname to `false | { path, index, params }`. A matcher written to exactly that
 * contract is handed to the router, and the router has to compile every pattern through it and route
 * on its answers.
 *
 * Flagged as an unverified claim during this audit's pass over the public documentation and left
 * open for several passes, because the obvious way to close it was an install. This is the other way.
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
const R = await load('router');
wire([renderer, R.router]);

/** path-to-regexp's documented signature, implemented from the documentation. */
const compiled = [];
const pathToRegexpShaped = (pattern) => {
  compiled.push(pattern);
  const names = [];
  const source = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, name) => (names.push(name), '([^/]+)'));
  const expression = new RegExp(`^${source}$`);
  return (pathname) => {
    const found = expression.exec(pathname);
    if (!found) return false;
    const params = {};
    names.forEach((name, index) => (params[name] = found[index + 1]));
    return { path: pathname, index: 0, params };
  };
};

test('a matcher with path-to-regexp\'s contract replaces pattern matching', async () => {
  R.setMatchFunction(pathToRegexpShaped);
  const element = document.createElement('div');
  element.innerHTML = '<main view="main"></main>';
  document.body.appendChild(element);
  const { addRoutes } = R.initRouter(element, { view: 'main', handleInitial: false });
  addRoutes([
    { path: '/p2p/:id', component: ({ id }) => html`<p>id ${id}</p>` },
    { path: '/flat', component: () => html`<p>flat</p>` },
  ]);

  const view = element.querySelector('[view="main"]');
  await R.navigate('/p2p/42');
  flush();
  assert.equal(view.textContent.trim(), 'id 42', 'a param came back through the replacement matcher');

  await R.navigate('/flat');
  flush();
  assert.equal(view.textContent.trim(), 'flat', 'and a static pattern routes too');

  assert.ok(compiled.includes('/p2p/:id'), 'every pattern was compiled through the replacement');
  assert.ok(compiled.includes('/flat'), 'including the static ones');
});
