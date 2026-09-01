/**
 * Where an API has two ways in, both have to arrive at the same place.
 *
 * This exists because of a defect that was exactly that shape: `navigate()` and a clicked
 * `<a route href>` resolved paths differently, so seven of eight inputs silently matched nothing
 * through one door and worked through the other. A second spelling is the one nobody exercises, and
 * when the two doors live in different files nothing owns the comparison.
 *
 * A sweep of the nine dual-entry pairs in this framework found every one of them exercised
 * *somewhere* — but "exercised" is not "compared". These three had no single test asserting the two
 * forms agree, so they get one here. Each case runs both spellings and compares the **outcome**, not
 * the call.
 */
import { load } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});
const dom = new JSDOM('<div></div>', { url: 'http://localhost/start', virtualConsole });
const { window } = dom;
window.scrollTo = () => {};
for (const key of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent', 'Element', 'Node', 'ShadowRoot'])
  globalThis[key] = window[key];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = () => {};

const core = await load('core');
const { initRouter, navigate, setRouterRenderer } = await load('router');
setRouterRenderer((template, view) => {
  view.textContent = String(template);
});

/**
 * Each router gets a **path of its own**. Two routers over one document both match a shared path and
 * both write their views, which made the first version of this comparison read as a divergence when
 * it was two routers doing exactly what they should.
 */
const mount = (byName, prefix) => {
  const element = window.document.createElement('div');
  const view = window.document.createElement('main');
  if (byName) view.setAttribute('view', `v-${prefix}`);
  element.appendChild(view);
  window.document.body.appendChild(element);
  const router = initRouter(element, {
    view: byName ? `v-${prefix}` : view,
    focusView: false,
    handleInitial: false,
  });
  router.addRoutes([{ name: `r-${prefix}`, path: `/${prefix}/:id`, component: (params) => `id=${params.id}` }]);
  return view;
};

/** `view` is declared `HTMLElement | ShadowRoot | string`; the string form is the documented one. */
test('initRouter takes a view by name or by element, with the same result', async () => {
  const named = mount(true, 'named');
  const elemental = mount(false, 'elemental');
  await navigate('/named/1');
  await navigate('/elemental/1');
  assert.equal(named.textContent, 'id=1', 'the name form did not render');
  assert.equal(elemental.textContent, named.textContent, 'the element form disagreed with the name form');
});

/** `navigate({ name, params })` is documented as "the same call through resolve". */
test('navigate by path and by { name, params } reach the same route', async () => {
  const view = mount(true, 'both');
  await navigate('/both/7');
  const byPath = view.textContent;
  assert.equal(byPath, 'id=7');

  /** Away first: navigating to the path already current is a no-op, which would fake agreement. */
  await navigate('/both/8');
  await navigate({ name: 'r-both', params: { id: 7 } });
  assert.equal(view.textContent, byPath, 'the { name, params } form disagreed with the path form');
});

/**
 * `wire([a, b])` and two `wire(a); wire(b)` calls. Compared by what lands in the chain rather than by
 * a returned value — the array form is the one every README uses and the descriptor form is the one
 * every module registers with, so a difference would be invisible from either side alone.
 */
test('wire registers the same whether given an array or one descriptor at a time', () => {
  const count = () => (core.inserts.get('value') ?? []).length;

  const before = count();
  core.wire([
    { on: 'value', fn: () => {}, priority: 8121 },
    { on: 'value', fn: () => {}, priority: 8122 },
  ]);
  const viaArray = count() - before;

  const between = count();
  core.wire({ on: 'value', fn: () => {}, priority: 8131 });
  core.wire({ on: 'value', fn: () => {}, priority: 8132 });
  const viaCalls = count() - between;

  assert.equal(viaArray, 2, 'the array form did not register both descriptors');
  assert.equal(viaCalls, viaArray, 'one-at-a-time registered a different number than the array form');
});
