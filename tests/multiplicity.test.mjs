/**
 * Two of everything on one page.
 *
 * Multiplicity has bitten this project before: two autoloaders each adopted every marked host and
 * raced to load the same tags from their own directories, which is recorded in `autoloader.ts` as
 * the reason discovery stopped happening by itself. Pass 101's lens is that shape generally — the
 * things a page has more than one of, which per-feature tests instantiate exactly once.
 *
 * `@verajs/router`'s README opens by claiming **"several independent routers on one page"** and
 * nothing anywhere asserted it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { load } from './dist.mjs';

/** jsdom has no `window.scrollTo`, which the router calls on navigation as a browser wants. */
const dom = new JSDOM('<!doctype html><body></body>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: new VirtualConsole(),
});
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent', 'location', 'history',
                   'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'ShadowRoot', 'NodeFilter'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
const routerModule = await load('router');
core.wire([renderer, styles, routerModule.router]);

const D = dom.window.document;
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

test('two instances of one component keep separate state and both get the class sheet', async () => {
  customElements.define('x-twin', class extends HTMLElement {
    static styles = core.css`p { color: rgb(9, 9, 9) }`;
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      this._state = state;
      core.render(() => core.html`<p>${state.n}</p>`);
    }
  });
  const first = D.createElement('x-twin');
  const second = D.createElement('x-twin');
  D.body.append(first, second);
  await frame();

  first._state.n = 5;
  await frame();
  assert.equal(first.shadowRoot.querySelector('p').textContent, '5');
  assert.equal(second.shadowRoot.querySelector('p').textContent, '0',
    'writing one instance changed the other — the store is per instance, not per class');

  const styled = (el) => (el.shadowRoot.adoptedStyleSheets?.length ?? 0) > 0 || !!el.shadowRoot.querySelector('style');
  assert.ok(styled(first) && styled(second), 'static styles must reach every instance, not only the first');
});

/**
 * The claim `@verajs/router`'s README opens with. Each router owns its own view and its own routes,
 * and one navigation has to reach both — a single shared "current route" would render one and leave
 * the other stale, which is exactly what a page with a sidebar and a main area would show.
 */
test('two independent routers on one page both render the same navigation', async () => {
  const build = (id, prefix) => {
    const shell = D.createElement('div');
    shell.innerHTML = `<main view="${id}"></main>`;
    D.body.appendChild(shell);
    routerModule.initRouter(shell, { view: id }).addRoutes([
      { path: '/', component: () => core.html`<i>${prefix}-home</i>` },
      { path: '/x', component: () => core.html`<i>${prefix}-x</i>` },
    ]);
    return shell;
  };
  const one = build('m-one', 'one');
  const two = build('m-two', 'two');

  await routerModule.navigate('/x');
  await frame();
  await frame();
  assert.equal(one.querySelector('main').textContent, 'one-x', 'the first router did not render');
  assert.equal(two.querySelector('main').textContent, 'two-x', 'the second router did not render its own route');
});

test('one store shared by two components updates both', async () => {
  const shared = core.createStore({ v: 1 });
  const made = [];
  for (const tag of ['x-shared-a', 'x-shared-b']) {
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        core.init(this, { mode: 'open' });
        core.render(() => core.html`<b>${shared.v}</b>`);
      }
    });
    const element = D.createElement(tag);
    D.body.appendChild(element);
    made.push(element);
  }
  await frame();
  shared.v = 42;
  await frame();
  for (const element of made)
    assert.equal(element.shadowRoot.querySelector('b').textContent, '42',
      'a store held outside the components must drive all of them');
});
