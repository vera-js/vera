/**
 * **Every package that wires into the framework exports a module, and they are all the same shape.**
 *
 * `@verajs/styles` was the exception: it exported `adoptStyles` and nothing else, so an app entry
 * had to hand-write `{ on: 'init', fn: adoptStyles, priority: 50 }` — knowing which insert point
 * style adoption belongs to, and that 50 is the number, in order to use a package whose entire job
 * is one registration. Two of those three facts are the package's business. `wire([renderer, styles])`
 * now reads the same as `wire([renderer, router])`.
 *
 * The check is written over the *set* rather than per-package, so a new module that forgets its
 * descriptor is caught by the same line. What it asserts is the contract `wire` actually relies on:
 * a `name` (so the same-priority collision warning can say who), an `on` naming a real insert point,
 * an `fn`, and a finite `priority`.
 *
 * The second half is the trap this shape creates. A module sits next to the raw function it
 * registers — `renderer` beside `render`, `styles` beside `adoptStyles` — and `wire` hands a bare
 * function the registry as a *connector*, so wiring the function instead registers nothing and
 * throws nothing. `$module` is how each package says which name was meant; it is `__DEV__`-only, so
 * that half skips under production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
for (const key of ['HTMLElement', 'Event', 'CustomEvent', 'Node', 'Element', 'DocumentFragment', 'CSSStyleSheet', 'customElements'])
  globalThis[key] = dom.window[key];
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const core = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
const { collections } = await load('reactivity/collections');

/** Every descriptor-shaped module. `router` and `autoloader` are connectors, checked separately. */
const MODULES = [
  ['renderer', renderer, 'render'],
  ['styles', styles, 'init'],
  ['collections', collections, 'collection'],
];

test('every module is a well-formed descriptor', () => {
  for (const [label, module, on] of MODULES) {
    assert.equal(typeof module, 'object', `${label} is exported`);
    assert.equal(module.on, on, `${label} registers on '${on}'`);
    assert.equal(typeof module.fn, 'function', `${label} carries a callback`);
    assert.ok(Number.isFinite(module.priority), `${label} has a finite priority`);
    assert.match(module.name, /^@verajs\//, `${label} names itself for the collision warning`);
  }
});

test('wire takes them as a list, and styles adopts from it', () => {
  core.wire([renderer, styles]);

  const tag = 'x-module-styles';
  customElements.define(
    tag,
    class extends HTMLElement {
      static styles = 'p { color: rgb(1, 2, 3); }';
      connectedCallback() {
        core.init(this, { mode: 'open' });
        core.render(() => core.html`<p>hi</p>`);
      }
    }
  );

  const element = document.createElement(tag);
  document.body.appendChild(element);
  /** The `init` insert runs synchronously inside `init`, before any frame. */
  assert.match(element.shadowRoot.querySelector('style[vera-styles]').textContent, /rgb\(1, 2, 3\)/);
});

test('the raw function next to each module says which name was meant', { skip: isProduction }, async () => {
  const { renderInto } = await load('renderer');
  const { adoptStyles } = await load('styles');

  for (const [meant, fn] of [
    ['renderer', renderInto],
    ['styles', adoptStyles],
  ]) {
    assert.throws(
      () => core.wire([fn]),
      (error) => error.message.includes('is not a module') && error.message.includes(`\`${meant}\``),
      `wiring the bare function points at \`${meant}\``
    );
  }
});
