/**
 * **A computed lives while some run reads it** (C10, 2026-10-22). One rule — watched while read, and let go when its last
 * reader leaves — replaces an owner list: a run that stops reading a computed already unlinks it (at its end, or at its
 * first diverging read, a throwing run included), and the computed then unlinks from its sources by the end of that
 * microtask. Measured by EVALUATIONS: a watched computed re-evaluates inside the write that changes its source, an
 * unwatched one does not, so the evaluations one write causes count the computeds still linked. Every count is exact,
 * each with a control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, computed, useEffect, flush, inserts } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
/** Thrown renders are reported through the error chain; collected here so the run stays quiet. */
const reported = [];
wire({ on: 'error', fn: (error) => reported.push(error), priority: 25 });
const settle = async () => { flush(); await new Promise((r) => setTimeout(r, 0)); flush(); };
let seq = 0;
const tag = () => `x-cl-${++seq}`;
const mount = async (t) => { const el = document.createElement(t); document.body.append(el); await settle(); return el; };

test('a computed read by a component lets go when the component is removed — with NO write in between', async () => {
  const s = createStore({ n: 1 });
  let evals = 0;
  const c = computed(() => { evals++; return s.n; });
  const t = tag();
  define(t, () => () => html`<b>${c.value}</b>`);
  const el = await mount(t);
  const before = evals;
  s.n = 2;
  assert.equal(evals - before, 1, 'CONTROL: watched, a write evaluates it once, inside the write');
  await settle();
  el.remove();
  await settle();
  const after = evals;
  s.n = 3;
  assert.equal(evals - after, 0, 'unwatched: the write evaluates nothing');
  assert.equal(c.value, 3, 'and a read is current');
});

test('a render making 100 computeds per run keeps ONE run’s worth linked after 10 re-renders, and none once removed', async () => {
  const s = createStore({ n: 1, tick: 0 });
  let evals = 0;
  const t = tag();
  define(t, () => () => {
    void s.tick;
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += computed(() => { evals++; return s.n + i; }).value;
    return html`<b>${sum}</b>`;
  });
  const el = await mount(t);
  for (let i = 0; i < 10; i++) { s.tick++; await settle(); }
  const before = evals;
  s.n = 2;
  assert.equal(evals - before, 100, 'a write reaches exactly the last run’s 100, not 11 runs’ 1100');
  await settle();
  el.remove();
  await settle();
  const after = evals;
  s.n = 3;
  assert.equal(evals - after, 0, 'removed: nothing linked');
});

test('a render that makes 10 computeds and then THROWS, 50 times, keeps at most one run’s 10', async () => {
  const s = createStore({ n: 1, tick: 0, fail: false });
  let evals = 0;
  const t = tag();
  define(t, () => () => {
    void s.tick;
    for (let i = 0; i < 10; i++) void computed(() => { evals++; return s.n + i; }).value;
    if (s.fail) throw new Error('render failed');
    return html`<b>ok</b>`;
  });
  const el = await mount(t);
  s.fail = true;
  await settle();
  for (let i = 0; i < 50; i++) { s.tick++; await settle(); }
  assert.ok(reported.length >= 50, `CONTROL: the render threw on each run (${reported.length})`);
  const before = evals;
  s.n = 2;
  assert.equal(evals - before, 10, 'one run’s 10 linked');
  el.remove();
  await settle();
});

test('an effect making a computed per run keeps one linked after 20 runs', async () => {
  const s = createStore({ n: 1, tick: 0 });
  let evals = 0;
  let runs = 0;
  const t = tag();
  define(t, () => { useEffect(() => { void s.tick; runs++; void computed(() => { evals++; return s.n; }).value; }); return () => html`<i></i>`; });
  const el = await mount(t);
  for (let i = 0; i < 20; i++) { s.tick++; await settle(); }
  assert.equal(runs, 21, 'CONTROL: the effect ran 21 times');
  const before = evals;
  s.n = 2;
  assert.equal(evals - before, 1, 'one linked, not 21');
  el.remove();
  await settle();
});

/**
 * A re-run whose reads DIVERGE before a computed unlinks it and reads it again a moment later — the deferred release
 * keeps it watched through that. (Two keys read in swapped order do not diverge: the engine re-matches a swap. So each
 * branch reads a key the other never does.)
 */
test('a render whose reads diverge before a computed it keeps reading does not re-evaluate it', async () => {
  const s = createStore({ flip: false, p: 0, q: 0, n: 1 });
  let evals = 0;
  const c = computed(() => { evals++; return s.n; });
  const t = tag();
  define(t, () => () => {
    if (s.flip) void s.p;
    else void s.q;
    void c.value;
    return html`<i>${String(s.flip)}</i>`;
  });
  const el = await mount(t);
  assert.equal(evals, 1, 'CONTROL: evaluated once on the first render');
  for (let i = 0; i < 10; i++) { s.flip = !s.flip; await settle(); }
  assert.equal(el.textContent, 'false', 'CONTROL: it re-rendered ten times');
  assert.equal(evals, 1, 'its source never changed: no re-evaluation across ten diverging re-runs');
  const before = evals;
  s.n = 2;
  assert.equal(evals - before, 1, 'and it is still watched');
  el.remove();
  await settle();
});

test('a chain lets go link by link: a component reads c2, c2 reads c1 — removed, neither evaluates on a write', async () => {
  const s = createStore({ n: 1 });
  let e1 = 0;
  let e2 = 0;
  const c1 = computed(() => { e1++; return s.n * 2; });
  const c2 = computed(() => { e2++; return c1.value + 1; });
  const t = tag();
  define(t, () => () => html`<b>${c2.value}</b>`);
  const el = await mount(t);
  assert.equal(el.textContent, '3');
  s.n = 2;
  assert.deepEqual([e1, e2], [2, 2], 'CONTROL: watched, the write reached both');
  await settle();
  el.remove();
  await settle();
  await settle();
  s.n = 3;
  assert.deepEqual([e1, e2], [2, 2], 'unwatched, both: nothing evaluated');
  assert.equal(c2.value, 7, 'a read is current through the chain');
});

/**
 * **Pre-existing, pinned (vera-5a):** a run that THROWS after diverging at read `i` has already unlinked what the
 * previous run read after `i` — so "a throwing render keeps its links" means the links BEFORE the divergence. The
 * component stops hearing the later sources until a write to an earlier one re-runs it. Not new with C10: it is how a
 * re-run's divergence works.
 */
test('a throwing run that diverged keeps only the links before the divergence', async () => {
  const s = createStore({ a: 0, b: 0, later: 0, fail: false });
  let renders = 0;
  const t = tag();
  define(t, () => () => {
    renders++;
    void s.a;
    if (s.fail) { void s.b; throw new Error('after diverging'); }
    void s.later;
    return html`<i></i>`;
  });
  const el = await mount(t);
  s.fail = true;
  await settle();
  const before = renders;
  s.later = 1;
  await settle();
  assert.equal(renders - before, 0, 'a write to a source read only AFTER the divergence no longer reaches it');
  s.a = 1;
  await settle();
  assert.equal(renders - before, 1, 'CONTROL: a write to a source before the divergence still does');
  el.remove();
  await settle();
});

test('on a server turn, a render-made computed lets go when the turn ends', async () => {
  const s = createStore({ n: 1 });
  let evals = 0;
  const t = tag();
  inserts.$ss(1);
  let el;
  try {
    define(t, () => () => html`<b>${computed(() => { evals++; return s.n; }).value}</b>`);
    el = await mount(t);
  } finally {
    inserts.$ss(-1);
  }
  await settle();
  const before = evals;
  s.n = 2;
  assert.equal(evals - before, 0, 'after the turn: nothing linked');
  assert.ok(before >= 1, 'CONTROL: it evaluated during the turn');
  el.remove();
});
