/**
 * **An object's key map is bounded** (2026-10-23): a store keeps one subscription cell per key read, in that object's
 * key map, and a cell outlived its readers — so an object whose keys come and go (a dictionary, a cache, a selector's
 * ids) grew by ~145 B for every key it ever had. Core now sweeps a big map as it grows: a cell no reader holds is
 * deleted. These rows pin:
 *
 * - growth is BOUNDED for a dictionary whose keys are deleted, and for a selector whose ids only increase;
 * - a cell that still has a reader is kept (the retained control: rows that stay, each reading its key);
 * - the sweep runs before a NEW cell exists, so a read of a missing key still hears the write that adds it;
 * - a collection keyed by null-prototype objects is swept without throwing (an `in` test once threw converting the key);
 * - a cell swept while its own wake is running leaves the key working for the next reader.
 *
 * GROWTH is measured in a child process run with `--expose-gc` — the CLAUDE.md exception: gc is the instrument, alone
 * in its own process, with both controls (rows that read nothing of the dictionary, which must not grow; rows that STAY,
 * each reading its key, whose cells must be kept — the instrument seeing growth at all).
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
const { lists } = await load('renderer/keyed');
const { collections } = await load('store/collections');
wire([renderer, lists, collections]);
const settle = async () => { flush(); await new Promise((resolve) => setTimeout(resolve, 0)); };
const KEYS = Array.from({ length: 64 }, (_, i) => `k${i}`);

/** The child: 1000 rows, `K` churn steps (a row and its key added, the oldest row removed); heap growth in MB. */
const child = (mode, K = 10000) => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
    globalThis[k] = dom.window[k] ?? globalThis[k];
  const { load } = await import('./tests/dist.mjs');
  const { init, html, wire, createStore, flush } = await load('core');
  const { renderer } = await load('renderer');
  const { lists, createSelector } = await load('renderer/keyed');
  wire([renderer, lists]);
  const settle = () => new Promise((r) => setImmediate(r));
  const heap = async () => { for (let i = 0; i < 4; i++) { global.gc(); await settle(); } return process.memoryUsage().heapUsed / 1048576; };
  const mode = ${JSON.stringify(mode)};
  const K = ${K};
  const state = createStore({ rows: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 })), dict: {}, sel: 0 });
  for (let i = 1; i <= 1000; i++) state.dict[i] = 1;
  const host = document.createElement('div');
  document.body.append(host);
  if (mode === 'selector') init(host, () => { const is = createSelector(() => state.sel); return () => html\`<ul>\${state.rows.map((r) => html\`<li>\${is(r.id) ? 'x' : r.id}</li>\`)}</ul>\`; });
  else if (mode === 'none') init(host, () => () => html\`<ul>\${state.rows.map((r) => html\`<li>\${r.id}</li>\`)}</ul>\`);
  else init(host, () => () => html\`<ul>\${state.rows.map((r) => html\`<li>\${state.dict[r.id]}</li>\`)}</ul>\`);
  flush(); await settle();
  const h0 = await heap();
  for (let k = 0; k < K; k++) {
    const id = 100000 + k;
    if (mode !== 'none' && mode !== 'selector') state.dict[id] = 1;
    state.rows.push({ id });
    /** live: every row STAYS and keeps reading its key — those cells have readers and must all be kept. */
    if (mode === 'live') continue;
    const old = state.rows[0].id;
    state.rows.shift();
    if (mode === 'dict') delete state.dict[old];
    if (k % 50 === 0) { flush(); await settle(); }
  }
  flush(); await settle();
  const h1 = await heap();
  const rows = host.querySelectorAll('li').length;
  console.log(JSON.stringify({ grew: h1 - h0, rows: mode === 'live' ? rows - K : rows }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env } }));

test('a dictionary whose keys come and go stays bounded; cells with readers are kept (both controls)', () => {
  const none = child('none');
  const live = child('live');
  const dict = child('dict');
  assert.ok(none.rows === 1000 && live.rows === 1000 && dict.rows === 1000, `CONTROL: every run kept 1000 rows (${JSON.stringify({ none, live, dict })})`);
  /** The retained control: 10 000 more rows that stay, each with its key, value and live cell, must show as growth. */
  assert.ok(live.grew - none.grew > 1, `CONTROL: the instrument sees kept cells (live ${live.grew.toFixed(2)} MB vs none ${none.grew.toFixed(2)})`);
  /** Unbounded, 10 000 deleted keys left ~1.4 MB of cells; bounded, about the control's. */
  assert.ok(dict.grew - none.grew < 0.4, `a deleted dictionary's cells are swept (dict ${dict.grew.toFixed(2)} MB vs none ${none.grew.toFixed(2)})`);
});

test('a selector whose ids only increase stays bounded', () => {
  const none = child('none');
  const selector = child('selector');
  assert.ok(none.rows === 1000 && selector.rows === 1000, 'CONTROL: every run kept 1000 rows');
  assert.ok(selector.grew - none.grew < 0.4, `the selector's spent ids are swept (selector ${selector.grew.toFixed(2)} MB vs none ${none.grew.toFixed(2)})`);
});

test('a read of a MISSING key, made just as the map is swept, still hears the write that adds it', async () => {
  const state = createStore({ d: {}, on: false });
  const host = document.createElement('div');
  document.body.append(host);
  /** 64 missing keys read: the map reaches the sweep size; then `d.x` is read for the first time — a new, empty, absent cell. */
  init(host, () => () => html`<p>${KEYS.map((k) => state.d[k] ?? '-').join('')}|${state.on ? (state.d.x ?? 'none') : ''}</p>`);
  await settle();
  assert.ok(host.textContent.endsWith('|'), 'CONTROL: it rendered');
  /**
   * The 64th missing key's cell is the one made as the map REACHES the sweep size: written before anything re-renders
   * (a re-render would re-make an orphaned cell and hide it), its reader must hear it.
   */
  state.d.k63 = 'Y';
  await settle();
  assert.ok(host.textContent.includes('Y|'), `the 64th key's reader heard the write (${host.textContent.slice(-8)})`);
  state.on = true;
  await settle();
  assert.ok(host.textContent.endsWith('|none'), `CONTROL: the missing key read (${host.textContent.slice(-8)})`);
  state.d.x = 'set';
  await settle();
  assert.ok(host.textContent.endsWith('|set'), `the reader heard the write (${host.textContent.slice(-8)})`);
  host.remove();
});

test('a Map store keyed by null-prototype objects is swept without throwing, and stays live', async () => {
  /** The keys live OUTSIDE the store (in a store array they would be handed out as proxies, which no Map entry matches). */
  const state = createStore({ m: new Map(), round: 0 });
  let shown = [];
  const keyOf = () => Object.create(null);
  for (let i = 0; i < 70; i++) {
    const key = keyOf();
    state.m.set(key, i);
    shown.push(key);
  }
  const host = document.createElement('div');
  document.body.append(host);
  const errors = [];
  init(host, () => () => html`<p>${state.round}:${shown.map((k) => state.m.get(k)).join(',')}</p>`);
  await settle();
  assert.ok(host.textContent.startsWith('0:0,1,2'), `CONTROL: it rendered (${host.textContent.slice(0, 12)})`);
  /** Churn: the shown keys move on (their cells empty), and every NEW key read makes a cell in a map past the sweep size. */
  try {
    for (let round = 0; round < 3; round++) {
      const next = [];
      for (let i = 0; i < 70; i++) {
        const key = keyOf();
        state.m.set(key, 1000 * (round + 1) + i);
        next.push(key);
      }
      for (const key of shown) state.m.delete(key);
      shown = next;
      state.round++;
      await settle();
    }
  } catch (error) {
    errors.push(error);
  }
  assert.deepEqual(errors, [], 'no throw');
  assert.ok(host.textContent.startsWith('3:3000,3001'), `the last keys show (${host.textContent.slice(0, 14)})`);
  state.m.set(shown[0], 'live');
  await settle();
  assert.ok(host.textContent.startsWith('3:live,3001'), 'a write to a shown key still re-renders');
  host.remove();
});

test('a key whose cell is swept while its own wake runs still works for the next reader', async () => {
  const state = createStore({ d: { flag: 0 } });
  const hosts = [];
  /** A and B read `flag` only while it is 0; the write that sets it makes both stop reading it (its cell empties mid-wake). */
  for (let i = 0; i < 2; i++) {
    const host = document.createElement('div');
    document.body.append(host);
    init(host, () => () => html`<p>${state.d.flag === 0 ? 'zero' : 'past'}</p>`);
    hosts.push(host);
  }
  /** C runs last in the same wake, reading 80 NEW keys: its new cells pass the sweep size while `flag`'s wake is running. */
  const c = document.createElement('div');
  document.body.append(c);
  init(c, () => () => html`<p>${state.d.flag === 0 ? '' : Array.from({ length: 80 }, (_, i) => state.d[`n${i}`] ?? '').join('')}${state.d.flag}</p>`);
  await settle();
  assert.deepEqual(hosts.map((h) => h.textContent), ['zero', 'zero'], 'CONTROL: rendered');
  state.d.flag = 1;
  await settle();
  assert.deepEqual([...hosts.map((h) => h.textContent), c.textContent], ['past', 'past', '1'], 'the wake reached everyone');
  /** A NEW reader of `flag`, then a write: it must hear it. */
  const d = document.createElement('div');
  document.body.append(d);
  init(d, () => () => html`<p>${state.d.flag}</p>`);
  await settle();
  state.d.flag = 2;
  await settle();
  assert.equal(d.textContent, '2', 'the key still wakes its reader');
  assert.equal(c.textContent, '2', 'and its old reader');
  for (const h of [...hosts, c, d]) h.remove();
});
