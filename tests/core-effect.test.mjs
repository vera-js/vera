/**
 * **`effect(fn, options?)`** (2026-10-22) — the one primitive that replaced `useEffect`, `useLayoutEffect`,
 * `useSyncEffect`, `useHook` and `createHook`. Rows: the first-pass order of the timings and a custom priority; a
 * default effect coalesces writes, a `'sync'` one runs on each; the handle — `run()` by hand, `stop()` inert after a
 * write, a removal and a persist pause/resume, inside its own run, and twice (its cleanup exactly once); an effect with
 * an explicit non-element owner has no automatic first run; no owner throws `no-owner`; a non-finite priority is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, effect, flush } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { flush(); await wait(0); flush(); };
let seq = 0;
const tag = () => `x-fx-${++seq}`;
const mount = async (t) => { const el = document.createElement(t); document.body.append(el); await settle(); return el; };

test('first-pass order: priority 25, the render (50), layout (60), then effects (75) in registration order', async () => {
  const order = [];
  const t = tag();
  define(t, () => {
    effect(() => { order.push('effect'); });
    effect(() => { order.push('layout'); }, { timing: 'layout' });
    effect(() => { order.push('sync'); }, { timing: 'sync' });
    effect(() => { order.push('25'); }, { priority: 25 });
    return () => { order.push('render'); return html`<i></i>`; };
  });
  const el = await mount(t);
  assert.deepEqual(order, ['25', 'render', 'layout', 'effect', 'sync']);
  el.remove();
});

test('a default effect coalesces two writes into one run; a sync effect runs on each', async () => {
  const s = createStore({ n: 0 });
  let queued = 0;
  let sync = 0;
  const t = tag();
  define(t, () => {
    effect(() => { void s.n; queued++; });
    effect(() => { void s.n; sync++; }, { timing: 'sync' });
    return () => html`<i></i>`;
  });
  const el = await mount(t);
  s.n = 1;
  s.n = 2;
  assert.equal(sync, 3, 'sync: the first pass and once per write, at once');
  await settle();
  assert.equal(queued, 2, 'default: the first pass and ONE run for both writes');
  el.remove();
});

test('stop(): its cleanup runs once; then a write, a removal, a pause and a resume run nothing', async () => {
  const s = createStore({ n: 0 });
  let runs = 0;
  let cleanups = 0;
  let fx;
  const t = tag();
  define({ tag: t, persist: 0.3 }, () => {
    fx = effect(() => { void s.n; runs++; return () => cleanups++; });
    return () => html`<i></i>`;
  });
  const el = await mount(t);
  assert.deepEqual([runs, cleanups], [1, 0], 'CONTROL: it ran');
  fx.stop();
  assert.equal(cleanups, 1, 'stop runs its cleanup');
  s.n = 1;
  await settle();
  el.remove();
  await settle();
  document.body.append(el);
  await settle();
  assert.deepEqual([runs, cleanups], [1, 1], 'nothing ran it again, and its cleanup ran once');
  fx.stop();
  assert.equal(cleanups, 1, 'stop twice: no throw, the cleanup still once');
  el.remove();
});

test('stop() inside its own run ends it after that run', async () => {
  const s = createStore({ n: 0 });
  let runs = 0;
  let fx;
  const t = tag();
  define(t, () => {
    fx = effect(() => { void s.n; runs++; if (s.n === 1) fx.stop(); });
    return () => html`<i></i>`;
  });
  const el = await mount(t);
  s.n = 1;
  await settle();
  s.n = 2;
  await settle();
  assert.equal(runs, 2, 'the first pass and the run that stopped it — not the write after');
  el.remove();
});

test('an explicit non-element owner: no automatic first run; run() starts it, writes then re-run it', async () => {
  const s = createStore({ n: 0 });
  let runs = 0;
  const fx = effect(() => { void s.n; runs++; }, { owner: {} });
  await settle();
  assert.equal(runs, 0, 'not run until asked');
  fx.run();
  assert.equal(runs, 1);
  s.n = 1;
  await settle();
  assert.equal(runs, 2, 'subscribed by its run');
  fx.stop();
});

test('no component being set up and no owner: it throws no-owner', () => {
  assert.throws(() => effect(() => {}), /no-owner/);
});

test(`a non-finite priority is refused (undefined)${isProduction ? '' : ', and named'}`, async () => {
  const errors = [];
  const error = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  let fx = 'unset';
  try {
    fx = effect(() => {}, { owner: {}, priority: Number.NaN });
  } finally {
    console.error = error;
  }
  assert.equal(fx, undefined);
  assert.equal(errors.filter((e) => e.includes('priority-not-finite')).length, isProduction ? 0 : 1);
});
