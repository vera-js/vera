/**
 * A realistic CDN page: every module a real app loads, standalone, on one document.
 *
 * `cdn-cross-bundle.test.mjs` covers **two** bundles — core and the router — and guards the absence
 * of the two-registry hazard between them. A real page loads five or six, and the hazard it guards
 * is a property of the *set*: each production `.min.js` inlines its own `@verajs/inserts`, so every
 * additional bundle is another chance for a registration to land in a map nobody reads. `CLAUDE.md`
 * records that `@verajs/styles` was written the wrong way once and **passed every development test**,
 * which is the whole reason this runs against production too.
 *
 * The design that removes the hazard is that no module carries a registry: each is *handed* to
 * core's `wire`. This asserts that the design holds when all of them are handed over at once — one
 * `wire([…])` call, exactly as a CDN page writes it.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs). The production pass is the one
 * that means anything: it is the only place the bundles are genuinely separate code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { load } from './dist.mjs';

/** jsdom has no `window.scrollTo`, which the router calls on navigation exactly as a browser wants. */
const virtualConsole = new VirtualConsole();
const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole,
});
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent', 'location', 'history',
                   'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'ShadowRoot', 'NodeFilter'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
const routerModule = await load('router');
const { keyed } = await load('renderer/keyed');
const { spread } = await load('renderer/spread');

/** One call, every module handed over — the line a CDN page actually writes. */
core.wire([renderer, styles, routerModule.router]);

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

test('handing every module to core leaves exactly one render registry', () => {
  assert.equal(core.inserts.get('render')?.length, 1,
    'more than one means a bundle brought its own registry, which is the hazard this design removed');
});

test('a component using core, renderer, styles, keyed and spread works with all of them loaded', async () => {
  customElements.define('x-cdn-page', class extends HTMLElement {
    static styles = core.css`p { color: rgb(1, 2, 3) }`;
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ rows: ['a', 'b'], n: 1 });
      this._state = state;
      core.render(() => core.html`<div ${spread({ 'data-x': state.n })}>
        <ul>${state.rows.map((row) => keyed(row, core.html`<li data-id=${row}>${row}</li>`))}</ul>
        <p>tinted</p></div>`);
    }
  });
  const element = dom.window.document.createElement('x-cdn-page');
  dom.window.document.getElementById('app').appendChild(element);
  await frame();

  const root = element.shadowRoot;
  assert.equal(root.querySelectorAll('li').length, 2, 'the renderer did not render');
  assert.equal(root.querySelector('div').getAttribute('data-x'), '1', 'the spread did not apply');
  assert.ok(
    (root.adoptedStyleSheets?.length ?? 0) > 0 || root.querySelector('style'),
    'static styles were not adopted — the styles module registered where core does not read'
  );

  element._state.rows = ['b', 'a'];
  element._state.n = 2;
  await frame();
  assert.deepEqual([...root.querySelectorAll('li')].map((n) => n.dataset.id), ['b', 'a'], 'keyed did not reorder');
  assert.equal(root.querySelector('div').getAttribute('data-x'), '2', 'the spread did not update');
});

test('and the router navigates and renders a route on the same page', async () => {
  const shell = dom.window.document.createElement('div');
  shell.innerHTML = '<nav></nav><main view="main"></main>';
  dom.window.document.body.appendChild(shell);

  const router = routerModule.initRouter(shell, { view: 'main' });
  router.addRoutes([
    { path: '/', component: () => core.html`<h1>home</h1>` },
    { path: '/about', component: () => core.html`<h1>about</h1>` },
  ]);

  await routerModule.navigate('/about');
  await frame();
  await frame();
  assert.equal(shell.querySelector('[view="main"]').textContent.trim(), 'about',
    'the router changed the URL but nothing rendered — the classic two-registry symptom');
  assert.equal(dom.window.location.pathname, '/about');
});
