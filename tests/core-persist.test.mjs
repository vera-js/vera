/**
 * **Deferred teardown** (2026-10-22, Brian): a REMOVED component is paused — its author's `disconnectedCallback` and
 * every hook's cleanup run, its setup state and DOM stay — and a timer starts; re-added in time it RESUMES (every hook
 * once, the render first: what it missed is drawn), else it is torn down once. Two uses: `persist: seconds`, and —
 * automatically — a component whose async setup is still PENDING (re-added, the in-flight setup carries on: one setup,
 * never two continuations doubling its effects). Counts are exact, each with a control. Timings are short real waits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, useEffect, useHook, flush } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { flush(); await wait(0); flush(); };
let seq = 0;
const tag = () => `x-pz-${++seq}`;

/** A persisting component counting its setups, effect runs and cleanups, rendering the store. */
const persisting = (persist) => {
  const t = tag();
  const s = createStore({ n: 1 });
  const c = { setups: 0, runs: 0, cleanups: 0 };
  define({ tag: t, persist }, () => {
    c.setups++;
    useEffect(() => { void s.n; c.runs++; return () => c.cleanups++; });
    return () => html`<b>${s.n}</b>`;
  });
  const el = document.createElement(t);
  return { el, s, c };
};

test('persist: removed and re-added in time — one setup, effects cleaned at removal and re-run at resume, state kept', async () => {
  const { el, s, c } = persisting(0.3);
  document.body.append(el);
  await settle();
  assert.deepEqual(c, { setups: 1, runs: 1, cleanups: 0 }, 'CONTROL: set up once');
  el.remove();
  await settle();
  assert.equal(c.cleanups, 1, 'the effect cleaned up at the removal (its listeners stop)');
  await wait(50);
  document.body.append(el);
  await settle();
  assert.deepEqual(c, { setups: 1, runs: 2, cleanups: 1 }, 'resumed: no second setup, the effect re-ran');
  s.n = 2;
  await settle();
  assert.equal(el.textContent, '2', 'and it is live again');
  el.remove();
});

test('vera-5a’s blocker: a store write while paused is drawn at resume with no further write', async () => {
  const { el, s } = persisting(0.3);
  document.body.append(el);
  await settle();
  el.remove();
  await settle();
  s.n = 7;
  await settle();
  document.body.append(el);
  await settle();
  assert.equal(el.textContent, '7');
  el.remove();
});

test('persist expired: torn down once — cleanups not run twice — and a later re-add is a fresh setup', async () => {
  const { el, c } = persisting(0.1);
  document.body.append(el);
  await settle();
  el.remove();
  await wait(200);
  assert.deepEqual(c, { setups: 1, runs: 1, cleanups: 1 }, 'torn down; the cleanup ran once (at the pause)');
  document.body.append(el);
  await settle();
  assert.equal(c.setups, 2, 'a fresh setup after the window');
  el.remove();
});

test('CONTROL: without persist, removal tears down at once and a re-add sets up again', async () => {
  const { el, c } = persisting(undefined);
  document.body.append(el);
  await settle();
  el.remove();
  document.body.append(el);
  await settle();
  assert.equal(c.setups, 2);
});

for (const bad of [Infinity, true, -1, '30'])
  test(`persist: ${String(bad)} is not seconds: torn down at removal in both builds${isProduction ? '' : ', named at each setup'}`, async () => {
    const warns = [];
    const warn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const { el, c } = persisting(bad);
      document.body.append(el);
      await settle();
      el.remove();
      document.body.append(el);
      await settle();
      assert.equal(c.setups, 2, 'torn down at once');
    } finally {
      console.warn = warn;
    }
    assert.equal(warns.filter((w) => w.includes('persist-not-seconds')).length, isProduction ? 0 : 2, 'one per setup (it was set up twice)');
  });

test('persist: 0 is the default, said nothing: torn down at removal', async () => {
  const warns = [];
  const warn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const { el, c } = persisting(0);
    document.body.append(el);
    await settle();
    el.remove();
    document.body.append(el);
    await settle();
    assert.equal(c.setups, 2);
  } finally {
    console.warn = warn;
  }
  assert.equal(warns.filter((w) => w.includes('persist-not-seconds')).length, 0);
});

/** The async-setup hazard (internal e5/stale.mjs): removed and re-added while the setup awaits. */
test('a PENDING async setup re-added before it settles carries on: one setup, its after-await hook never doubled', async () => {
  const t = tag();
  const s = createStore({ n: 0 });
  let release;
  let setups = 0;
  let runs = 0;
  define(t, async (host) => {
    setups++;
    await new Promise((r) => (release = r));
    useHook(() => { void s.n; runs++; }, 75, host);
    return () => html`<b>${s.n}</b>`;
  });
  const el = document.createElement(t);
  document.body.append(el);
  await settle();
  el.remove();
  await settle();
  document.body.append(el);
  await settle();
  release();
  await settle();
  assert.equal(setups, 1, 'one setup');
  const before = runs;
  s.n = 1;
  await settle();
  assert.equal(runs - before, 1, 'one run per write — never two');
  assert.equal(el.textContent, '1');
  el.remove();
});

test('a pending setup that REJECTS while removed is torn down once, and a later re-add sets up fresh', async () => {
  const t = tag();
  let fail;
  let setups = 0;
  const reported = [];
  wire({ on: 'error', fn: (e) => reported.push(e), priority: 25 });
  define(t, async () => { setups++; await new Promise((_, r) => (fail = r)); return () => html`<b>x</b>`; });
  const el = document.createElement(t);
  document.body.append(el);
  await settle();
  el.remove();
  fail(new Error('no'));
  await wait(20);
  assert.ok(reported.some((e) => e?.message === 'no'), 'CONTROL: the rejection was reported');
  await wait(5100);
  document.body.append(el);
  await settle();
  assert.equal(setups, 2, 'torn down after its window; a fresh setup');
  el.remove();
});

test(`a pending setup that NEVER settles: the removed component is torn down at the bound${isProduction ? '' : ', and development says so'}`, async () => {
  const t = tag();
  let setups = 0;
  const warns = [];
  const warn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    define(t, async () => { setups++; await new Promise(() => {}); });
    const el = document.createElement(t);
    document.body.append(el);
    await settle();
    el.remove();
    await wait(5100);
    document.body.append(el);
    await settle();
    assert.equal(setups, 2, 'torn down at the bound; a fresh setup after');
    el.remove();
  } finally {
    console.warn = warn;
  }
  /** Its OWN tag: an earlier row's component, removed with a fresh pending setup, can reach its bound during this wait. */
  assert.equal(warns.filter((w) => w.includes('setup-outlived-removal') && w.includes(`<${t}>`)).length, isProduction ? 0 : 1);
});
