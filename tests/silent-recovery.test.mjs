/**
 * **A recovery path is not finished until it reports.**
 *
 * The generalisation from the hydration-fallback pass (`tests/hydrate-mismatch.test.mjs`): correct
 * behaviour that hides a real problem is harder to find than a crash, because there is nothing to
 * follow. This file holds the two remaining places the framework recovered in silence.
 *
 * - **A navigation that matches nothing.** `addLinkListener` calls `preventDefault` before it calls
 *   `navigate`, so a `route` link pointing at a path no pattern covers swallows the click whole: no
 *   navigation, no URL change, no error. It looks like a broken listener, and the one thing the page
 *   cannot tell you is that the *path* is wrong. A guard returning `false` reaches the same line and
 *   must stay quiet — that is a deliberate cancellation.
 * - **`static styles` on an engine with no `@scope`.** The block is hoisted to the document
 *   *unscoped*, because dropping it would leave the component unstyled. That is the right trade and
 *   a different thing than scoped: a rule written for one tag now applies page-wide. The author
 *   cannot see it, because they are developing on an engine that has `@scope` and the person who is
 *   not is a user.
 *
 * Both are `__DEV__`-only, so this whole file is a development-condition test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Event', 'CustomEvent', 'PopStateEvent', 'NodeFilter'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
/** jsdom prints "Not implemented" through its virtual console for this; the router calls it on every route. */
dom.window.scrollTo = () => {};

const { html, wire } = await load('core');
const { renderer } = await load('renderer');
const { initRouter, navigate, router } = await load('router');
wire([renderer, router]);

const skip = isProduction && 'development-only diagnostics';

/** Runs `body` with `console.warn` captured, and hands back what it said. */
const warnings = async (body) => {
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    await body();
  } finally {
    console.warn = warn;
  }
  return said;
};

const app = () => {
  const element = document.createElement('div');
  const view = document.createElement('main');
  element.appendChild(view);
  document.body.appendChild(element);
  return { element, view };
};

test('a navigation that matches nothing says so', { skip }, async () => {
  const { element, view } = app();
  const { addRoutes } = initRouter(element, { view: () => view, handleInitial: false });
  addRoutes([{ path: '/known', component: () => html`<p>k</p>` }]);

  const said = await warnings(() => navigate('/nowhere'));
  assert.equal(said.length, 1, JSON.stringify(said));
  assert.match(said[0], /^\[vera\] router: nothing matched "\/nowhere"/);
  assert.match(said[0], /catch-all/, 'and says what to do about it');

  assert.deepEqual(await warnings(() => navigate('/known')), [], 'a path that matches is silent');
});

test('a guard cancelling a navigation is not a mismatch, and stays quiet', { skip }, async () => {
  const { element, view } = app();
  const { addRoutes } = initRouter(element, { view: () => view, handleInitial: false });
  addRoutes([{ path: '/guarded', beforeEnter: () => false, component: () => html`<p>g</p>` }]);
  assert.deepEqual(await warnings(() => navigate('/guarded')), []);
});

test('static styles without @scope report that they went global', { skip }, async () => {
  const { adoptStyles } = await load('styles');
  const { init } = await load('core');
  wire([{ on: 'init', fn: adoptStyles, priority: 50, name: '@verajs/styles' }]);
  const present = globalThis.CSSScopeRule;
  delete globalThis.CSSScopeRule;
  try {
    let n = 0;
    const said = await warnings(() => {
      for (const tag of ['scope-a', 'scope-b']) {
        customElements.define(
          tag,
          class extends HTMLElement {
            static styles = 'p { color: red }';
            connectedCallback() {
              init(this);
              n++;
            }
          }
        );
        document.body.appendChild(document.createElement(tag));
      }
    });
    assert.equal(n, 2, 'both components initialised');
    assert.equal(said.length, 1, `one warning per page, not per class — ${JSON.stringify(said)}`);
    assert.match(said[0], /^\[vera\] styles: this engine has no/);
    assert.match(said[0], /unscoped/);
  } finally {
    if (present !== undefined) globalThis.CSSScopeRule = present;
  }
});
