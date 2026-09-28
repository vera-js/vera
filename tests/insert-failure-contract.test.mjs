/**
 * **What happens when the extension point itself throws.**
 *
 * A `useEffect` that throws is isolated and reported, because core runs an element's hooks in one
 * loop and an escaping error would skip every hook after the failing one. An insert is not in that
 * position and does not get the same treatment — a `'store'` insert is consulted inside the store's
 * first use of a value, and the handler it supplies runs inside the store's own traps, so a throw
 * comes out of `state.count = 1` (or the read) at the line that did it, which is the most useful place
 * it could surface. Swallowing it would leave the write undefined, since the handler has already
 * decided whether the value propagates.
 *
 * That difference was true and undocumented. It is asserted here rather than left to be discovered
 * by someone writing the batching insert the README recommends, and it is written down in
 * `packages/inserts/README.md`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { readFileSync } from 'node:fs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Event', 'CustomEvent', 'NodeFilter', 'MutationObserver', 'ShadowRoot'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { init, createStore, createHook, render, wire, html, useEffect } = await load('core');
const { renderer, renderInto } = await load('renderer');
wire([renderer]);

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

let n = 0;
const mount = (body) => {
  const tag = `insert-fail-${++n}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      body.call(this);
    }
  });
  const element = document.createElement(tag);
  document.body.appendChild(element);
  return element;
};

test('a `store` handler whose set throws surfaces at the assignment', () => {
  const throwingSet = (value, handler) =>
    handler?.set && { ...handler, set() { throw new Error('from the insert'); } };
  wire([{ on: 'store', fn: throwingSet, priority: 10, name: 'throwing-set' }]);
  const state = createStore({ count: 0 });
  assert.throws(() => { state.count = 1; }, /from the insert/, 'the write is where a person can act on it');
  /** Replaced at the same priority, which is the documented way to take one back out — for the values
   *  a store meets from then on; one already decided keeps its handler. */
  wire([{ on: 'store', fn: () => undefined, priority: 10, name: 'restore' }]);
  const fresh = createStore({ count: 0 });
  fresh.count = 2;
  assert.equal(fresh.count, 2, 'and a store met afterwards works');
});

test('an `init` insert that throws surfaces at init() — and the chain STOPS there', () => {
  /**
   * The README says `'init'` and `'render'` "run inside `init()` and the render, so a throw
   * surfaces there". True, and it is only half of what a person needs: the chain is not isolated
   * either, so every insert AFTER the failing one is skipped. `'init'` is where `@verajs/styles`,
   * `@verajs/autoloader` and anything else with per-element setup hooks in, so one throwing module
   * silently prevents the rest from initializing at all. Pinned so the consequence is a decision
   * rather than a discovery (arc-2 run 4).
   */
  const ran = [];
  wire([
    { on: 'init', fn: () => ran.push('before'), priority: 11, name: 'a2-init-before' },
    { on: 'init', fn: () => { throw new Error('from the init insert'); }, priority: 12, name: 'a2-init-throws' },
    { on: 'init', fn: () => ran.push('after'), priority: 13, name: 'a2-init-after' },
  ]);
  let caught = null;
  mount(function () {
    try { init(this); } catch (error) { caught = /** @type {Error} */ (error).message; }
  });
  assert.match(caught ?? '', /from the init insert/, 'the throw surfaces at init(), where the element is');
  assert.deepEqual(ran, ['before'], 'the chain stops: the insert after the failing one never ran');

  /** Taken back out the documented way, so the rest of this file is unaffected. */
  wire([{ on: 'init', fn: () => {}, priority: 12, name: 'a2-init-restore' }]);
  ran.length = 0;
  mount(function () { init(this); });
  assert.deepEqual(ran, ['before', 'after'], 'and with the thrower replaced, the whole chain runs again');
});

test('a hook that throws does not, and the hooks beside it still run', async () => {
  const ran = [];
  const reported = [];
  const error = console.error;
  console.error = (...args) => reported.push(args[0]);
  try {
    mount(function () {
      init(this, { mode: 'open' });
      useEffect(() => { ran.push('a'); throw new Error('from the hook'); });
      useEffect(() => ran.push('b'));
      useEffect(() => ran.push('c'));
      render(() => html`<p>x</p>`);
    });
    await frame();
    await frame();
  } finally {
    console.error = error;
  }
  assert.deepEqual(ran, ['a', 'b', 'c'], 'one failing effect must not stop the others');
  assert.equal(reported.length, 1, 'and the failure is reported, not swallowed');
});

test('a render that throws leaves the page as it was, and recovers on the next write', async () => {
  const reported = [];
  const error = console.error;
  console.error = (...args) => reported.push(args[0]);
  let element;
  try {
    element = mount(function () {
      init(this, { mode: 'open' });
      const state = createStore({ n: 0 });
      render(() => {
        if (state.n === 1) throw new Error('from the render');
        return html`<p>${state.n}</p>`;
      });
      this.state = state;
    });
    await frame();
    assert.equal(element.shadowRoot.textContent, '0');
    element.state.n = 1;
    await frame();
    assert.equal(element.shadowRoot.textContent, '0', 'the last good render stays on the page');
    assert.ok(reported.length >= 1, 'and the failure is reported');
    element.state.n = 2;
    await frame();
    assert.equal(element.shadowRoot.textContent, '2', 'and the next write renders normally');
  } finally {
    console.error = error;
  }
});

/**
 * **Every extension point the types declare is documented, and behaves as the section says.**
 *
 * `packages/inserts/README.md` is the whole public description of this surface, and it listed five
 * of seven. The point `@verajs/store/collections` ships to implement (then `'collection'`, now
 * `'store'`) and `'value'` were in `InsertFunctionMap` and in neither the table nor the throws
 * section, so an author of either had no documented answer to "what happens if mine throws".
 *
 * Checked against the declaration rather than against a list written here, so adding a point to
 * `InsertFunctionMap` and forgetting the README fails instead of shipping.
 */
test('the README documents every point the types declare', () => {
  const types = readFileSync(new URL('../packages/inserts/src/types.ts', import.meta.url), 'utf8');
  const map = types.match(/export type InsertFunctionMap = \{([\s\S]*?)\}/);
  assert.ok(map, 'InsertFunctionMap is gone or has changed shape');
  const declared = [...map[1].matchAll(/'([a-z-]+)':/g)].map((m) => m[1]);
  assert.ok(declared.length >= 7, `only found ${declared.length} declared points`);

  const readme = readFileSync(new URL('../packages/inserts/README.md', import.meta.url), 'utf8');
  const undocumented = declared.filter((point) => !readme.includes(`\`'${point}'\``));
  assert.deepEqual(undocumented, [], `declared extension points missing from the README: ${undocumented.join(', ')}`);

  /** And specifically from the table, which is what someone reads to find them at all. */
  const rows = [...readme.matchAll(/^\| `'([a-z-]+)'` \|/gm)].map((m) => m[1]);
  const missingFromTable = declared.filter((point) => !rows.includes(point));
  assert.deepEqual(missingFromTable, [], `declared points missing from the README's table: ${missingFromTable.join(', ')}`);
});

/**
 * The two the section had not covered, asserted the way its own rationale predicts: both run inside
 * something the caller invoked, so both surface there rather than being swallowed.
 */
test('a `store` insert that throws surfaces at the use that consulted it — and the store tries again', () => {
  wire({ name: 'store-thrower', on: 'store', fn: () => { throw new Error('store-boom'); }, priority: 3 });
  const state = createStore({ tags: 1 });
  assert.throws(() => state.tags, /store-boom/, 'a throwing store insert was swallowed');
  /** Put it back; the store was never decided, so its next use consults the chain afresh. */
  wire({ name: 'store-thrower', on: 'store', fn: () => undefined, priority: 3 });
  /** Reactive, not merely readable: a store stripped of its traps would still read back `1`. */
  let runs = 0;
  const hook = createHook({ element: {}, priority: 10, callback: () => { runs++; void state.tags; } });
  hook(undefined, true);
  state.tags = 2;
  assert.equal(runs, 2, 'the failed decision was not kept — the store is still reactive');
});

test('a `value` insert that throws surfaces at the render that committed the value', () => {
  wire({ name: 'value-thrower', on: 'value', fn: () => { throw new Error('value-boom'); }, priority: 3 });
  /** A string never reaches the chain — the renderer takes a fast path — so this uses an object. */
  assert.throws(
    () => renderInto(html`<p>${{ not: 'text' }}</p>`, document.createElement('div')),
    /value-boom/,
    'a throwing value insert was swallowed'
  );
  wire({ name: 'value-thrower', on: 'value', fn: () => undefined, priority: 3 });
});

test('a `value` insert is not consulted for text, which the table now says', () => {
  const seen = [];
  wire({ name: 'value-watcher', on: 'value', fn: (part, value) => { seen.push(typeof value); }, priority: 4 });
  for (const value of ['text', 42, null, undefined]) {
    seen.length = 0;
    renderInto(html`<p>${value}</p>`, document.createElement('div'));
    assert.deepEqual(seen, [], `the value chain was consulted for ${JSON.stringify(value)}`);
  }
  renderInto(html`<p>${{ an: 'object' }}</p>`, document.createElement('div'));
  assert.deepEqual(seen, ['object'], 'the value chain was not consulted for an object');
  wire({ name: 'value-watcher', on: 'value', fn: () => undefined, priority: 4 });
});
