/**
 * Public API of `@verajs/core` that nothing else exercises.
 *
 * The 2026-08-22 testing audit found fourteen exported functions with zero coverage. These are the
 * core ones. Each test asserts the behaviour the export exists *for*, so deleting the export or
 * gutting it fails here rather than passing quietly.
 *
 * Tests the BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.customElements = dom.window.customElements;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;

const core = await load('core');
const {
  init, createStore, render, useEffect, useSyncEffect, useLayoutEffect, useRender,
  ref, shallowRef, untrack, deps, html, css, setHtml, setCss,
  setRenderScheduler, microtask, setRenderer,
} = core;

/** A frame plus a macrotask — long enough for any scheduler to have flushed. */
const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let host;
let seq = 0;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

/** Mounts a component body against a real element, so hooks have an instance to attach to. */
const mount = (body) => {
  const tag = `x-api-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      body(this);
    }
  });
  const el = document.createElement(tag);
  host.appendChild(el);
  return el;
};

// ── untrack ─────────────────────────────────────────────────────────────────

test('untrack reads the current value without subscribing', async () => {
  let runs = 0;
  let seenB;
  const state = createStore({ a: 0, b: 'first' });
  mount(() => {
    useSyncEffect(() => {
      void state.a;                       // tracked
      seenB = untrack(() => state.b);     // read, but not subscribed
      runs++;
    });
    render(() => html`<i>${state.a}</i>`);
  });
  await settle();
  const baseline = runs;
  assert.equal(seenB, 'first', 'untrack still returns the value');

  state.b = 'second';
  await settle();
  assert.equal(runs, baseline, 'changing an untracked read does NOT re-run the effect');

  state.a = 1;
  await settle();
  assert.ok(runs > baseline, 'the tracked read still re-runs it');
  assert.equal(seenB, 'second', 'and untrack sees the current value when it does');
});

// ── ref / shallowRef ────────────────────────────────────────────────────────

test('ref is reactive through nested properties', async () => {
  let runs = 0;
  const box = ref({ nested: { n: 0 } });
  mount(() => {
    useSyncEffect(() => { void box.value.nested.n; runs++; });
    render(() => html`<i>x</i>`);
  });
  await settle();
  const baseline = runs;
  box.value.nested.n = 1;
  await settle();
  assert.ok(runs > baseline, 'a deep write notifies');
});

test('shallowRef does not proxy what it holds, but replacing .value notifies', async () => {
  let runs = 0;
  const box = shallowRef({ nested: { n: 0 } });
  mount(() => {
    useSyncEffect(() => { void box.value; runs++; });
    render(() => html`<i>x</i>`);
  });
  await settle();

  const afterMount = runs;
  box.value.nested.n = 99;
  await settle();
  assert.equal(runs, afterMount, 'mutating INSIDE a shallowRef does not notify — that is the point');

  box.value = { nested: { n: 1 } };
  await settle();
  assert.ok(runs > afterMount, 'replacing the value does notify');
});

// ── deps ────────────────────────────────────────────────────────────────────

test('deps() subscribes an effect to state it does not otherwise read', async () => {
  let runs = 0;
  const state = createStore({ watched: 0, ignored: 0 });
  mount(() => {
    useSyncEffect(() => { deps(state.watched); runs++; });
    render(() => html`<i>x</i>`);
  });
  await settle();
  const baseline = runs;

  state.ignored = 1;
  await settle();
  assert.equal(runs, baseline, 'untouched state does not re-run it');

  state.watched = 1;
  await settle();
  assert.ok(runs > baseline, 'state passed to deps() does');
});

// ── setHtml / setCss ────────────────────────────────────────────────────────

test('setHtml swaps the template tag core hands to the renderer', async () => {
  const seen = [];
  setRenderer((result) => seen.push(result));
  const marker = Symbol('custom-tag');
  setHtml((strings, ...values) => ({ marker, strings, values }));
  try {
    mount(() => { render(() => core.html`<p>${1}</p>`); });
    await settle();
    assert.equal(seen.at(-1)?.marker, marker, 'the replacement tag produced the result');
    assert.deepEqual(seen.at(-1)?.values, [1]);
  } finally {
    setHtml(html);
  }
});

test('setCss swaps the css tag', () => {
  const original = css;
  const marker = Symbol('custom-css');
  setCss((strings, ...values) => ({ marker, strings, values }));
  try {
    assert.equal(core.css`a { color: red }`.marker, marker);
  } finally {
    setCss(original);
  }
});

// ── setRenderScheduler / microtask ──────────────────────────────────────────

test('setRenderScheduler(microtask) renders before the next animation frame', async () => {
  setRenderer(() => {});
  const order = [];
  const previous = setRenderScheduler(microtask);
  try {
    const state = createStore({ n: 0 });
    setRenderer(() => order.push('render'));
    mount(() => { render(() => html`<i>${state.n}</i>`); });
    await settle();

    order.length = 0;
    state.n = 1;
    /** A microtask resolves before rAF; if the scheduler were still rAF this would be empty. */
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(order, ['render'], 'the render already ran on the microtask queue');
  } finally {
    setRenderScheduler(previous);
  }
});

/**
 * The return value is the whole point: without it there is no way to read the current scheduler, so
 * anything swapping temporarily can only *guess* what to put back — and would silently undo an
 * app's own `microtask` choice.
 */
test('setRenderScheduler returns the scheduler it replaced', () => {
  const first = (run) => run();
  const second = (run) => run();
  const original = setRenderScheduler(first);
  try {
    assert.equal(typeof original, 'function', 'the default scheduler came back');
    assert.equal(setRenderScheduler(second), first, 'and then the one just installed');
    assert.equal(setRenderScheduler(original), second);
  } finally {
    setRenderScheduler(original);
  }
});

/**
 * What the return value buys: a synchronous render. The View Transitions API snapshots the DOM
 * around a callback, so a render deferred to the next frame lands *after* the snapshot and the
 * transition captures nothing — `document.startViewTransition(() => flushSync(…))` is the recipe,
 * and this is the four lines it rests on.
 */
test('a userland flushSync renders synchronously and restores the scheduler', async () => {
  const order = [];
  setRenderer(() => order.push('render'));
  const state = createStore({ n: 0 });
  mount(() => { render(() => html`<i>${state.n}</i>`); });
  await settle();

  const flushSync = (fn) => {
    const previous = setRenderScheduler((run) => run());
    try { fn(); } finally { setRenderScheduler(previous); }
  };

  order.length = 0;
  state.n = 1;
  assert.deepEqual(order, [], 'the default scheduler defers past the write');
  await settle();

  order.length = 0;
  flushSync(() => { state.n = 2; });
  assert.deepEqual(order, ['render'], 'inside flushSync the render already happened');

  order.length = 0;
  state.n = 3;
  assert.deepEqual(order, [], 'and the deferring scheduler is back afterwards');
  await settle();
});

// ── useLayoutEffect / useRender ─────────────────────────────────────────────

test('useLayoutEffect runs, and before useEffect', async () => {
  const order = [];
  setRenderer(() => {});
  const state = createStore({ n: 0 });
  mount(() => {
    useLayoutEffect(() => { void state.n; order.push('layout'); });
    useEffect(() => { void state.n; order.push('effect'); });
    render(() => html`<i>${state.n}</i>`);
  });
  await settle();
  assert.ok(order.includes('layout'), 'useLayoutEffect ran');
  assert.ok(order.includes('effect'), 'useEffect ran');
  assert.ok(order.indexOf('layout') < order.indexOf('effect'), 'layout runs before effect');
});

test('useRender renders into an element given explicitly', async () => {
  const seen = [];
  setRenderer((result, element) => seen.push({ result, element }));
  const el = document.createElement('div');
  host.appendChild(el);
  init(el, { mode: 'open' });
  useRender(() => html`<b>direct</b>`, el);
  el.runHooks();
  await settle();
  /**
   * `setRenderer` hands the renderer `element.shadowRoot ?? element`, so a component with a shadow
   * root renders INTO the shadow root, not the host. That indirection is the whole reason
   * components do not have to unwrap it themselves — asserted here because nothing else does.
   *
   * `setRenderer` is also global and earlier components in this file are still live, so filter for
   * the target rather than assuming the last entry.
   */
  const mine = seen.filter((s) => s.element === el.shadowRoot);
  assert.equal(mine.length > 0, true, 'useRender drove the renderer into the element it was given');
  assert.equal(seen.some((s) => s.element === el), false, 'the host itself is never the target');
});
