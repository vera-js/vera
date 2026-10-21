/**
 * **Automatic `.map`** (PROTOTYPE, probe/cells-auto, B1): a plain `state.rows.map(fn)` in a render is a keyed list whose
 * rows track themselves. These rows pin what the probes found (2026-10-20):
 *
 * - a field write re-renders ONE row, and the parent never runs;
 * - **clearing a list releases its rows.** `state.rows = []` took the plain path, so the list's walk never ran, and its
 *   rows stayed alive and subscribed (Chrome: 12.22 MB retained after a clear, landed's idiom 4.50);
 * - a call site that maps an empty array still takes its place in the parent's order, so a later `.map` keeps its own
 *   list.
 *
 * RETENTION is measured in a child process run with `--expose-gc`, the one exception to "tests do not force collection"
 * (CLAUDE.md): gc is the instrument, alone in its own process, with both controls (a dropped object that must die, a
 * kept list whose rows must still update). A leftover row is a HOOK RECORD kept alive (cells hold hooks strongly), counted
 * with `v8.queryObjects` by core's hook class.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { init, html, wire, createStore, flush } = await load('core');
const { renderer } = await load('renderer');
const { eachList } = await load('renderer/keyed');
wire([renderer, eachList]);
const settle = async () => { flush(); await new Promise((resolve) => setTimeout(resolve, 0)); };
const make = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, t: `${prefix}${i + 1}` }));

test('a field write re-renders exactly one row, and a cleared list stays cleared', async () => {
  const state = createStore({ rows: make('r', 100) });
  let rows = 0;
  let parents = 0;
  const host = document.createElement('div');
  document.body.append(host);
  init(host, () => () => { parents++; return html`<ul>${state.rows.map((r) => { rows++; return html`<li>${r.t}</li>`; })}</ul>`; });
  await settle();
  /** 100 rows + the call site's DECIDING run of its first item (option C: a row returning a template makes a list). */
  assert.equal(rows, 101, 'CONTROL: the first render ran every row, plus the deciding run');
  const removed = state.rows[3];
  rows = parents = 0;
  state.rows[3].t = 'R4';
  await settle();
  assert.deepEqual({ rows, parents }, { rows: 1, parents: 0 }, 'one row, no parent');
  state.rows = [];
  await settle();
  assert.equal(host.querySelector('ul').children.length, 0, 'the list is empty');
  rows = parents = 0;
  removed.t = 'gone';
  await settle();
  assert.deepEqual({ rows, parents }, { rows: 0, parents: 0 }, 'a write to a removed item runs nothing');
  host.remove();
});

test('a row returning a template WITHOUT the marker is still a list (the renderer\'s own definition: `strings`)', async () => {
  const state = createStore({ rows: make('m', 3) });
  let rows = 0;
  let parents = 0;
  const host = document.createElement('div');
  document.body.append(host);
  /** A hand-built result the renderer accepts: `strings` and `values`, no `_$litType$`. */
  const strings = Object.assign(['<li>', '</li>'], { raw: ['<li>', '</li>'] });
  init(host, () => () => { parents++; return html`<ul>${state.rows.map((r) => { rows++; return { strings, values: [r.t] }; })}</ul>`; });
  await settle();
  assert.equal([...host.querySelector('ul').children].map((li) => li.textContent).join(), 'm1,m2,m3', 'CONTROL: it rendered');
  rows = parents = 0;
  state.rows[1].t = 'M2';
  await settle();
  assert.deepEqual({ rows, parents }, { rows: 1, parents: 0 }, 'a list: one row, no parent');
  host.remove();
});

test('a call site mapping an EMPTY array keeps its place: the next list stays its own', async () => {
  const state = createStore({ a: make('a', 3), b: make('b', 3) });
  let a = 0;
  let b = 0;
  const host = document.createElement('div');
  document.body.append(host);
  init(host, () => () => html`<ul>${state.a.map((r) => { a++; return html`<li>${r.t}</li>`; })}</ul><ol>${state.b.map((r) => { b++; return html`<li>${r.t}</li>`; })}</ol>`);
  await settle();
  state.a = [];
  await settle();
  a = b = 0;
  state.b[1].t = 'B2';
  await settle();
  assert.deepEqual({ a, b }, { a: 0, b: 1 }, 'a write to b re-renders one b row');
  state.a = make('n', 2);
  await settle();
  a = b = 0;
  state.a[0].t = 'N1';
  await settle();
  assert.deepEqual({ a, b }, { a: 1, b: 0 }, 'after the refill, a write to a re-renders one a row');
  assert.equal([...host.querySelector('ul').children].map((li) => li.textContent).join(), 'N1,n2');
  assert.equal([...host.querySelector('ol').children].map((li) => li.textContent).join(), 'b1,B2,b3');
  host.remove();
});

test('an INDEX callback before a list takes its place without stealing it (vera-5a): the list stays a list while it is hidden', async () => {
  const state = createStore({ open: true, a: make('a', 3), b: make('b', 3) });
  let b = 0;
  let parents = 0;
  const host = document.createElement('div');
  document.body.append(host);
  init(host, () => () => { parents++; return html`<ul>${state.open ? state.a.map((r, i) => html`<li>${i}:${r.t}</li>`) : ''}</ul><ol>${state.b.map((r) => { b++; return html`<li>${r.t}</li>`; })}</ol>`; });
  await settle();
  state.open = false;
  await settle();
  b = parents = 0;
  state.b[1].t = 'B2';
  await settle();
  assert.deepEqual({ b, parents }, { b: 1, parents: 0 }, 'with the index map hidden, a write to b re-renders one b row and never the parent');
  assert.equal([...host.querySelector('ol').children].map((li) => li.textContent).join(), 'b1,B2,b3');
  host.remove();
});

/** The child: one list of `n` rows created and cleared `rounds` times, a kept list alive throughout; hook records counted. */
const child = (mode) => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  import v8 from 'node:v8';
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
    globalThis[k] = dom.window[k] ?? globalThis[k];
  const { load } = await import('./tests/dist.mjs');
  const { init, html, wire, createStore, flush } = await load('core');
  const { renderer } = await load('renderer');
  const { eachList } = await load('renderer/keyed');
  wire([renderer, eachList]);
  const settle = () => new Promise((r) => setImmediate(r));
  const gc = async () => { for (let i = 0; i < 4; i++) { global.gc(); await settle(); } };
  const mode = ${JSON.stringify(mode)};
  const make = (n, from) => Array.from({ length: n }, (_, i) => ({ id: from + i, t: 'r' + i }));
  const state = createStore({ rows: [], kept: make(10, 1), open: true, outer: [{ id: 0, open: true }] });
  const host = document.createElement('div');
  const keep = document.createElement('div');
  document.body.append(host, keep);
  init(keep, () => () => html\`<ol>\${state.kept.map((r) => html\`<li>\${r.t}</li>\`)}</ol>\`);
  /** hide: the list is HIDDEN behind a condition and its data never written again — it must still be released. */
  /** nest: the list is NESTED in a row, which hides it on its own write — only the ROW's run sees it go (option (e″)). */
  if (mode === 'nest' || mode === 'nest2') init(host, () => () => html\`<ul>\${state.outer.map((o) => html\`<li>\${o.open ? state.rows.map((r) => html\`<b>\${r.t}</b>\`) : ''}</li>\`)}</ul>\`);
  else if (mode === 'hide') init(host, () => () => html\`<ul>\${state.open ? state.rows.map((r) => html\`<li>\${r.t}</li>\`) : ''}</ul>\`);
  else init(host, () => () => html\`<ul>\${state.rows.map((r) => html\`<li>\${r.t}</li>\`)}</ul>\`);
  flush(); await settle();
  /** Core's hook class, taken from a live hook (cells hold hooks strongly: a leftover row is a hook record kept alive). */
  const Hook = keep._$h$[0].constructor;
  const count = () => v8.queryObjects(Hook, { format: 'count' });
  const dropped = new WeakRef({ plain: true });
  await gc();
  const start = count();
  let peak = 0;
  /** hide: ONE list of 1000 rows shown, then hidden, and nothing written after — only the parent's sweep can release it. */
  for (let round = 0; round < (mode === 'clear' ? 5 : 1); round++) {
    state.rows = make(1000, 1000 * (round + 1));
    flush(); await settle();
    await gc();
    peak = Math.max(peak, count() - start);
    if (mode === 'clear') state.rows = [];
    if (mode === 'hide') state.open = false;
    if (mode === 'nest') state.outer[0].open = false;
    /** nest2 (vera-5a): ONE flush wakes a nested row, grows the nested array AND hides the list — every death path at once. */
    if (mode === 'nest2') { state.rows[0].t = 'w'; state.rows.push({ id: 1, t: 'p' }); state.outer[0].open = false; }
    flush(); await settle();
  }
  /** nest2: then a NEW nested list is shown and hidden — it must still be released (the count of row-owned lists held). */
  if (mode === 'nest2') {
    state.rows = make(1000, 50000);
    state.outer[0].open = true;
    flush(); await settle();
    state.outer[0].open = false;
    flush(); await settle();
  }
  await gc();
  state.kept[3].t = 'K';
  flush(); await settle();
  process.stdout.write(JSON.stringify({
    peak, left: count() - start,
    droppedDied: dropped.deref() === undefined,
    keptLive: keep.textContent.includes('K'),
  }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env } }));

/**
 * KNOWN DEFECT, a `todo` (2026-10-20): the sweep is scheduled from inside an automatic `.map` call, so a parent run that HIDES
 * a list and maps nothing else schedules none — a hidden list over data nobody writes keeps its rows alive and subscribed
 * until the parent maps again or one of its rows is written. The complete fix needs a signal that does not depend on
 * `.map` being called (the renderer telling a list its part no longer shows it, or matching lists by their array instead of
 * their order): a design point for Brian, with raw-array-first matching. It flips to a plain test when fixed.
 */
test('HIDING a list releases its rows too, with no further write (vera-5a): the parent run that hid it disposes it (option (e))', () => {
  const r = child('hide');
  assert.ok(r.droppedDied && r.keptLive, `CONTROLS (${JSON.stringify(r)})`);
  assert.ok(r.peak >= 1000, `CONTROL: the live list held its rows' hooks while it lived (peak ${r.peak})`);
  assert.ok(r.left <= 2, `${r.left} hook records left after hiding (rows not released)`);
});

test('a row HIDING its nested list releases the nested rows, with no further write: the row\'s own run disposes it', () => {
  const r = child('nest');
  assert.ok(r.droppedDied && r.keptLive, `CONTROLS (${JSON.stringify(r)})`);
  assert.ok(r.peak >= 1000, `CONTROL: the live nested list held its rows' hooks while it lived (peak ${r.peak})`);
  assert.ok(r.left <= 2, `${r.left} hook records left after the row hid its list (nested rows not released)`);
});

test('a nested list that dies by every path in ONE flush, then a new one hidden: the new one is released too (vera-5a)', () => {
  const r = child('nest2');
  assert.ok(r.droppedDied && r.keptLive, `CONTROLS (${JSON.stringify(r)})`);
  assert.ok(r.peak >= 1000, `CONTROL: the live nested list held its rows' hooks while it lived (peak ${r.peak})`);
  assert.ok(r.left <= 2, `${r.left} hook records left after the second nested list was hidden`);
});

test('clearing a list RELEASES its rows: nothing of 5 × 1000 created-and-cleared rows is left', () => {
  const r = child('clear');
  assert.ok(r.droppedDied && r.keptLive, `CONTROLS: gc ran and the kept list still updates (${JSON.stringify(r)})`);
  assert.ok(r.peak >= 1000, `CONTROL: the live list held its rows' hooks while it lived (peak ${r.peak})`);
  assert.ok(r.left <= 2, `${r.left} hook records left after the last clear (rows not released)`);
});
