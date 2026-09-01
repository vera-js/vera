/**
 * **What happens when the extension point itself throws.**
 *
 * A `useEffect` that throws is isolated and reported, because core runs an element's hooks in one
 * loop and an escaping error would skip every hook after the failing one. An insert is not in that
 * position and does not get the same treatment — `'set-handler'` and `'proxy-handler'` run inside
 * the store's own traps, so a throw comes out of `state.count = 1` at the line that wrote it, which
 * is the most useful place it could surface. Swallowing it would leave the write undefined, since a
 * handler has already decided whether the value propagates, and those are the two hottest paths in
 * the framework besides.
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

const { init, createStore, render, wire, html, useEffect } = await load('core');
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

test('a `set-handler` that throws surfaces at the assignment', () => {
  /** Priority 10, so it runs before the default propagation and cannot be mistaken for it. */
  wire([{ on: 'set-handler', fn: () => { throw new Error('from the insert'); }, priority: 10, name: 'throwing-set' }]);
  const state = createStore({ count: 0 });
  assert.throws(() => { state.count = 1; }, /from the insert/, 'the write is where a person can act on it');
  /** Replaced at the same priority, which is the documented way to take one back out. */
  wire([{ on: 'set-handler', fn: () => undefined, priority: 10, name: 'restore' }]);
  state.count = 2;
  assert.equal(state.count, 2, 'and the store still works afterwards');
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
 * of seven. `'collection'` — the point `@verajs/reactivity/collections` ships to implement — and
 * `'value'` were in `InsertFunctionMap` and in neither the table nor the throws section, so an
 * author of either had no documented answer to "what happens if mine throws".
 *
 * Checked against the declaration rather than against a list written here, so adding a point to
 * `InsertFunctionMap` and forgetting the README fails instead of shipping.
 */
test('the README documents every point the types declare', () => {
  const types = readFileSync(new URL('../packages/inserts/src/types.d.ts', import.meta.url), 'utf8');
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
test('a `collection` insert that throws surfaces at the mutation', async () => {
  wire({ name: 'collection-thrower', on: 'collection', fn: () => { throw new Error('collection-boom'); }, priority: 3 });
  const state = createStore({ tags: new Set() });
  assert.throws(() => state.tags.add('x'), /collection-boom/, 'a throwing collection insert was swallowed');
  /** Put it back so the rest of the file is unaffected. */
  wire({ name: 'collection-thrower', on: 'collection', fn: () => undefined, priority: 3 });
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
