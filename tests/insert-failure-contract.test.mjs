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

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Event', 'CustomEvent', 'NodeFilter', 'MutationObserver', 'ShadowRoot'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { init, createStore, render, wire, html, useEffect } = await load('core');
const { renderer } = await load('renderer');
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
