/**
 * **What the framework says when you hand it the wrong thing.**
 *
 * Both entry points here validated one half of their input carefully and never asked the first
 * question — is this the shape I take at all — so a mistake was reported as something else, or as
 * nothing:
 *
 * - `wire(undefined)`, which is what a mistyped import name produces, reached the descriptor branch
 *   and threw *"priority must be a finite number, and `undefined` is not"*. True, and about the
 *   wrong thing: it sends the reader looking for a priority they never wrote.
 * - `initRouter(el, { view, routes })` ignored `routes` in silence. That is how Vue Router is
 *   initialised and so the first thing anyone tries; the router then came up with no routes, every
 *   navigation matched nothing, and the empty outlet looked like a broken router. TypeScript tells
 *   the typed caller. Nothing told the buildless one, and buildless is a first-class mode here.
 *
 * The same sweep covered the framework's other option bags. A route object and an autoloader's
 * config are both closed sets, and both ignored an unknown key in silence — the route case matters
 * most, because the keys people reach for are the neighbouring routers' spellings (`components` from
 * Vue Router, `element` and `loader` from React Router), each of which registers a route that
 * matches its path and then renders nothing. `ShadowRootInit` is deliberately *not* guarded: it is
 * the platform's dictionary, and the platform's own behaviour is to ignore what it does not know.
 *
 * All of these checks are `__DEV__`-only — a production bundle carries neither the text nor the branch —
 * so this whole file is a development-condition test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
for (const key of ['HTMLElement', 'Event', 'CustomEvent', 'PopStateEvent', 'Node']) globalThis[key] = dom.window[key];
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const { wire } = await load('core');
const { initRouter } = await load('router');
const { autoloader } = await load('autoloader');

/** A fresh router per test, since `initRouter` remembers the element it was given. */
const app = () => {
  const element = document.createElement('div');
  const view = document.createElement('main');
  element.appendChild(view);
  document.body.appendChild(element);
  return { element, view };
};

/** Runs `body` with `console.warn` captured, and hands back what it said. */
const warnings = (body) => {
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    body();
  } finally {
    console.warn = warn;
  }
  return said;
};

test('wire says what it was handed, not what it failed to read off it', { skip: isProduction && 'development-only diagnostics' }, () => {
  for (const notAModule of [null, undefined, 'renderer', 42]) {
    assert.throws(
      () => wire([notAModule]),
      (error) => /expected a module or an insert descriptor/.test(error.message),
      `wire(${String(notAModule)}) reported the wrong cause`
    );
  }
  for (const notADescriptor of [{}, { on: 'render' }, { fn: () => {} }, { on: 'render', fn: 'nope' }]) {
    assert.throws(
      () => wire([notADescriptor]),
      (error) => /is not an insert descriptor/.test(error.message),
      `wire(${JSON.stringify(notADescriptor)}) reported the wrong cause`
    );
  }
  /** A descriptor that *is* one still gets the priority message, which is the check that was there. */
  assert.throws(() => wire([{ on: 'render', fn: () => {}, priority: Number('x') }]), /priority must be a finite number/);
});

test('initRouter names an option it does not have', { skip: isProduction && 'development-only diagnostics' }, () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const element = document.createElement('div');
    const view = document.createElement('main');
    element.appendChild(view);
    document.body.appendChild(element);
    initRouter(element, { view, routes: [{ path: '/', component: () => '' }], handleInitial: false });
  } finally {
    console.warn = warn;
  }
  const about = warnings.filter((line) => line.includes('`routes`'));
  assert.equal(about.length, 1, `expected one warning about \`routes\`, got ${JSON.stringify(warnings)}`);
  assert.match(about[0], /^\[vera\] /, 'a console diagnostic carries the prefix');
  assert.match(about[0], /addRoutes/, 'and says where routes actually go');
});

test('initRouter stays quiet about the options it does have', { skip: isProduction && 'development-only diagnostics' }, () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const element = document.createElement('div');
    const view = document.createElement('main');
    element.appendChild(view);
    document.body.appendChild(element);
    initRouter(element, { view, focusView: false, handleInitial: false, pushHash: false, scrollBehavior: () => {}, hashChangeFunction: () => {} });
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, []);
});

test('a route object names a key it does not have', { skip: isProduction && 'development-only diagnostics' }, () => {
  const { element, view } = app();
  const said = warnings(() => {
    const { addRoutes } = initRouter(element, { view, handleInitial: false });
    addRoutes([
      /** `components` is Vue Router's spelling and `element` is React Router's. Both render nothing here. */
      { path: '/a', components: {}, element: 1, meta: { requiresAuth: true }, component: () => '' },
      { path: '/b', name: 'b', component: () => '' },
    ]);
  });
  assert.equal(said.length, 2, `expected two warnings, got ${JSON.stringify(said)}`);
  assert.ok(said.some((line) => line.includes('`components`')), 'named components');
  assert.ok(said.some((line) => line.includes('`element`')), 'named element');
  for (const line of said) {
    assert.match(line, /^\[vera\] /);
    assert.match(line, /"\/a"/, 'and says which route');
    assert.match(line, /`meta`/, 'and where arbitrary data goes');
  }
});

test('an alias does not repeat the warning for the same typo', { skip: isProduction && 'development-only diagnostics' }, () => {
  const { element, view } = app();
  const said = warnings(() => {
    const { addRoutes } = initRouter(element, { view, handleInitial: false });
    addRoutes([{ path: '/p', alias: ['/q', '/r'], component: () => '', loader: 1, children: [{ path: 'k', element: 1, component: () => '' }] }]);
  });
  assert.equal(said.filter((line) => line.includes('`loader`')).length, 1, JSON.stringify(said));
  assert.equal(said.filter((line) => line.includes('`element`')).length, 1, 'a child under three patterns is still one typo');
});

test('the autoloader names an option it does not have', { skip: isProduction && 'development-only diagnostics' }, () => {
  const said = warnings(() => autoloader('http://localhost/app.js', 'components', { extensions: '.ts', resolve: (tag) => tag }));
  assert.equal(said.length, 1, JSON.stringify(said));
  assert.match(said[0], /^\[vera\] autoloader: `extensions` is not an option/);
  /** And the two it does have stay quiet. */
  assert.deepEqual(warnings(() => autoloader('http://localhost/app.js', 'components', { extension: '.ts', resolve: (tag) => tag })), []);
});
