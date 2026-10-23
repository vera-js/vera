/**
 * Public API of `@verajs/core` that nothing else exercises.
 *
 * The 2026-08-22 testing audit found fourteen exported functions with zero coverage. These are the
 * core ones. Each test asserts the behavior the export exists *for*, so deleting the export or
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
const { init, createStore, effect, signal, untrack, html, setRenderScheduler, microtask, wire } = core;

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
      /** The body IS the setup: it returns its render. */
      init({ host: this, shadow: 'open' }, () => body(this));
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
    effect(() => {
      void state.a;                       // tracked
      seenB = untrack(() => state.b);     // read, but not subscribed
      runs++;
    }, { timing: 'sync' });
    return () => html`<i>${state.a}</i>`;
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

// ── signal (shallow) / signal deep ────────────────────────────────────────────────────────

test('ref is reactive through nested properties', async () => {
  let runs = 0;
  const box = signal({ nested: { n: 0 } }, { deep: true });
  mount(() => {
    effect(() => { void box.value.nested.n; runs++; }, { timing: 'sync' });
    return () => html`<i>x</i>`;
  });
  await settle();
  const baseline = runs;
  box.value.nested.n = 1;
  await settle();
  assert.ok(runs > baseline, 'a deep write notifies');
});

test('signal (shallow) does not proxy what it holds, but replacing .value notifies', async () => {
  let runs = 0;
  const box = signal({ nested: { n: 0 } });
  mount(() => {
    effect(() => { void box.value; runs++; }, { timing: 'sync' });
    return () => html`<i>x</i>`;
  });
  await settle();

  const afterMount = runs;
  box.value.nested.n = 99;
  await settle();
  assert.equal(runs, afterMount, 'mutating INSIDE a shallow signal does not notify — that is the point');

  box.value = { nested: { n: 1 } };
  await settle();
  assert.ok(runs > afterMount, 'replacing the value does notify');
});

// ── setRenderScheduler / microtask ──────────────────────────────────────────

test('setRenderScheduler(microtask) renders before the next animation frame', async () => {
  wire({ on: 'render', fn: () => {}, priority: 50 });
  const order = [];
  const previous = setRenderScheduler(microtask);
  try {
    const state = createStore({ n: 0 });
    wire({ on: 'render', fn: () => order.push('render'), priority: 50 });
    mount(() => { return () => html`<i>${state.n}</i>`; });
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
  wire({ on: 'render', fn: () => order.push('render'), priority: 50 });
  const state = createStore({ n: 0 });
  mount(() => { return () => html`<i>${state.n}</i>`; });
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

// ── effect: layout timing ─────────────────────────────────────────────

test('useLayoutEffect runs, and before useEffect', async () => {
  const order = [];
  wire({ on: 'render', fn: () => {}, priority: 50 });
  const state = createStore({ n: 0 });
  mount(() => {
    effect(() => { void state.n; order.push('layout'); }, { timing: 'layout' });
    effect(() => { void state.n; order.push('effect'); });
    return () => html`<i>${state.n}</i>`;
  });
  await settle();
  assert.ok(order.includes('layout'), 'useLayoutEffect ran');
  assert.ok(order.includes('effect'), 'useEffect ran');
  assert.ok(order.indexOf('layout') < order.indexOf('effect'), 'layout runs before effect');
});

/** the setup's returned render was removed (2026-10-22): a setup returns its render; drawing into ANOTHER element is `portal` (the renderer's rows). */
