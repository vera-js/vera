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
 * Both checks are `__DEV__`-only — a production bundle carries neither the text nor the branch —
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
