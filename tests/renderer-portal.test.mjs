/**
 * **`portal(target, template)`** (2026-10-22, the API distillation: it replaced `useRender`'s one job no returned render
 * can do — drawing into ANOTHER element). Every row the design required before `useRender` was removed: its own marked
 * range (two share a target), the render's slot (keyed rows follow their items; drawn before layout effects), what its
 * draw made freed, removal and pause, server output and hydration. Counts are exact, each with a control.
 */
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

/** The server half: a component with a portal, rendered by the real pipeline (`tests/fixtures/ssr/portal-ssr.js`). */
const served = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr';
  const warned = [];
  console.warn = (...a) => warned.push(a.map(String).join(' '));
  const r = await renderToString(new URL('./tests/fixtures/ssr/portal-ssr.js', 'file://' + process.cwd() + '/'), { tag: 'portal-ssr' });
  process.stdout.write(JSON.stringify({ html: r.html, runs: globalThis.__portalRuns, warned }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

const dom = new JSDOM('<!doctype html><body><iframe></iframe></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, init, html, wire, createStore, computed, effect, flush } = await load('core');
const { renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
const { lists } = await load('renderer/keyed');
const { portal } = await load('renderer/portal');
wire([renderer, hydration, lists]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { flush(); await wait(0); flush(); };
let seq = 0;
const tag = () => `x-po-${++seq}`;
const mount = async (t, parent = document.body) => { const el = document.createElement(t); parent.append(el); await settle(); return el; };
/** The target's children, comments named: what a portal leaves or takes. */
const shape = (node) => [...node.childNodes].map((n) => (n.nodeType === 8 ? '#c' : n.nodeType === 3 ? `"${n.data}"` : n.localName));

test('a portal draws into its own marked range, after what the target held, and follows the store', async () => {
  const target = document.createElement('div');
  target.append(document.createElement('hr'));
  document.body.append(target);
  const s = createStore({ n: 1 });
  const t = tag();
  define(t, () => { portal(target, () => html`<b>${s.n}</b>`); return () => html`<i>own</i>`; });
  const el = await mount(t);
  assert.deepEqual(shape(target), ['hr', '#c', 'b', '#c'], 'one range, appended');
  assert.equal(el.textContent, 'own', 'CONTROL: the component still renders itself');
  s.n = 2;
  await settle();
  assert.equal(target.querySelector('b').textContent, '2', 'live');
  el.remove();
  await settle();
  target.remove();
});

test('two portals share one target — neither replaces the other — and each removal takes only its own range', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const a = tag(), b = tag();
  define(a, () => { portal(target, html`<b>a</b>`); });
  define(b, () => { portal(target, html`<i>b</i>`); });
  const ea = await mount(a);
  const eb = await mount(b);
  assert.deepEqual(shape(target), ['#c', 'b', '#c', '#c', 'i', '#c'], 'both drawn');
  ea.remove();
  await settle();
  assert.deepEqual(shape(target), ['#c', 'i', '#c'], 'a took its content AND its markers');
  eb.remove();
  await settle();
  assert.deepEqual(shape(target), [], 'and b');
  target.remove();
});

test('the render slot: a keyed .map keeps rows with their items on a reverse, and a layout effect sees the drawn content', async () => {
  const target = document.createElement('ul');
  document.body.append(target);
  const s = createStore({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  /** A row whose SETUP captures its item: a row that stayed in place on a reverse would show the wrong one. */
  define({ tag: 'x-po-row', props: { id: '' } }, (host) => { const mine = host.id; return () => html`<span>${mine}</span>`; });
  const seen = [];
  const t = tag();
  define(t, () => {
    portal(target, () => html`${s.items.map((item) => html`<li><x-po-row .id=${item.id}></x-po-row></li>`)}`);
    effect(() => { void s.items.length; seen.push(target.querySelectorAll('li').length); }, { timing: 'layout' });
  });
  const el = await mount(t);
  assert.deepEqual(seen, [3], 'the layout effect ran after the portal drew');
  const first = target.querySelector('li');
  s.items.reverse();
  await settle();
  assert.equal(target.textContent, 'cba', 'each row shows its own item — the setup state followed the item');
  assert.equal(target.lastElementChild, first, 'the row node moved with item a');
  el.remove();
  await settle();
  target.remove();
});

test('what a draw makes and no longer reaches is freed: computeds per run keep one run, none once removed', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const s = createStore({ n: 1, tick: 0 });
  let evals = 0;
  const t = tag();
  define(t, () => {
    portal(target, () => {
      void s.tick;
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += computed(() => { evals++; return s.n + i; }).value;
      return html`<b>${sum}</b>`;
    });
  });
  const el = await mount(t);
  for (let i = 0; i < 5; i++) { s.tick++; await settle(); }
  let before = evals;
  s.n = 2;
  assert.equal(evals - before, 10, 'one run’s 10, not six runs’ 60');
  await settle();
  el.remove();
  await settle();
  before = evals;
  s.n = 3;
  assert.equal(evals - before, 0, 'removed: nothing linked');
  target.remove();
});

test('an automatic list the draw hides stops drawing (its array written after)', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const s = createStore({ show: true, items: [1, 2] });
  let rowRenders = 0;
  const t = tag();
  define(t, () => {
    portal(target, () => (s.show ? html`${s.items.map((n) => { rowRenders++; return html`<p>${n}</p>`; })}` : html`<em></em>`));
  });
  const el = await mount(t);
  const control = rowRenders;
  assert.equal(control, 2, 'CONTROL: the list drew its two rows');
  s.show = false;
  await settle();
  s.items.push(3);
  await settle();
  assert.equal(rowRenders, control, 'hidden: a write to its array draws nothing');
  el.remove();
  await settle();
  target.remove();
});

test('persist: a paused owner takes its range out; back in time it draws again, set up once', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const s = createStore({ n: 1 });
  let setups = 0;
  const t = tag();
  define({ tag: t, persist: 0.3 }, () => { setups++; portal(target, () => html`<b>${s.n}</b>`); });
  const el = await mount(t);
  assert.deepEqual(shape(target), ['#c', 'b', '#c'], 'CONTROL: drawn');
  el.remove();
  await settle();
  assert.deepEqual(shape(target), [], 'paused: out of the target');
  s.n = 2;
  document.body.append(el);
  await settle();
  assert.deepEqual(shape(target), ['#c', 'b', '#c'], 'resumed: drawn again, once');
  assert.equal(target.textContent, '2', 'with what changed while out');
  assert.equal(setups, 1, 'no second setup');
  el.remove();
  await wait(400);
  await settle();
  assert.deepEqual(shape(target), [], 'torn down: still out');
  target.remove();
});

/**
 * **Hiding a list RELEASES its rows** — what the portal's `settle` after each draw is for. Nothing observable shows it (a
 * hidden list's rows never run again either way), so this counts core's hook records in an isolated child process, gc
 * as the instrument, with both controls: a kept list that must still update and a dropped plain object that must die.
 */
const hideChild = () => JSON.parse(execFileSync(process.execPath, [...(process.env.VERA_DIST === 'production' ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  import v8 from 'node:v8';
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
    globalThis[k] = dom.window[k] ?? globalThis[k];
  const { load } = await import('./tests/dist.mjs');
  const { init, html, wire, createStore, flush } = await load('core');
  const { renderer } = await load('renderer');
  const { lists } = await load('renderer/keyed');
  const { portal } = await load('renderer/portal');
  wire([renderer, lists]);
  const settle = () => new Promise((r) => setImmediate(r));
  const gc = async () => { for (let i = 0; i < 4; i++) { global.gc(); await settle(); } };
  const make = (n, from) => Array.from({ length: n }, (_, i) => ({ id: from + i, t: 'r' + i }));
  const state = createStore({ rows: [], kept: make(10, 1), open: true });
  const host = document.createElement('div');
  const keep = document.createElement('div');
  const target = document.createElement('div');
  document.body.append(host, keep, target);
  init(keep, () => () => html\`<ol>\${state.kept.map((r) => html\`<li>\${r.t}</li>\`)}</ol>\`);
  init(host, () => { portal(target, () => html\`<ul>\${state.open ? state.rows.map((r) => html\`<li>\${r.t}</li>\`) : ''}</ul>\`); });
  flush(); await settle();
  const Hook = keep._$h$[0].constructor;
  const count = () => v8.queryObjects(Hook, { format: 'count' });
  const dropped = new WeakRef({ plain: true });
  await gc();
  const start = count();
  state.rows = make(1000, 1000);
  flush(); await settle();
  await gc();
  const peak = count() - start;
  state.open = false;
  flush(); await settle();
  await gc();
  state.kept[3].t = 'K';
  flush(); await settle();
  process.stdout.write(JSON.stringify({ peak, left: count() - start, droppedDied: dropped.deref() === undefined, keptLive: keep.textContent.includes('K') }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env } }));

test('a list the draw HIDES releases its rows, with no further write: the portal settles its draw as a render does', () => {
  const r = hideChild();
  assert.ok(r.droppedDied && r.keptLive, `CONTROLS (${JSON.stringify(r)})`);
  assert.ok(r.peak >= 1000, `CONTROL: the live list held its rows' hooks while it lived (peak ${r.peak})`);
  assert.ok(r.left <= 2, `${r.left} hook records left after hiding (rows not released)`);
});

test('a portal into a shadow host draws its LIGHT content, slotted', async () => {
  const host = tag(), t = tag();
  define({ tag: host, shadow: 'open' }, () => () => html`<p><slot></slot></p>`);
  const h = await mount(host);
  define(t, () => { portal(h, html`<b>light</b>`); });
  const el = await mount(t);
  assert.equal(h.querySelector('b')?.textContent, 'light', 'in the host’s light DOM');
  assert.equal(h.shadowRoot.querySelector('b'), null, 'never its shadow root');
  el.remove();
  h.remove();
  await settle();
});

test('a cross-window MOVE of the owner leaves its portal where it is, live — no teardown, no second range', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const s = createStore({ n: 1 });
  const t = tag();
  define(t, () => { portal(target, () => html`<b>${s.n}</b>`); });
  const el = await mount(t);
  assert.deepEqual(shape(target), ['#c', 'b', '#c'], 'CONTROL: drawn');
  document.querySelector('iframe').contentDocument.body.append(el);
  await settle();
  assert.equal(el.ownerDocument !== document, true, 'CONTROL: it moved into the other document');
  assert.deepEqual(shape(target), ['#c', 'b', '#c'], 'still drawn, once');
  s.n = 2;
  await settle();
  assert.equal(target.textContent, '2', 'and live');
  el.remove();
  await settle();
  assert.deepEqual(shape(target), [], 'a real removal still takes it out');
  target.remove();
});

test('server output: the server draws no portal; the client adopts the component and draws the portal once', async () => {
  const { html: markup, runs, warned: serverWarned } = JSON.parse(served);
  assert.deepEqual(serverWarned, [], 'the server said nothing (it registers no portal, so nothing finds no renderer)');
  assert.equal(markup, '<portal-ssr><p>own</p></portal-ssr>', 'the component’s own template, and nothing of the portal');
  assert.equal(runs, 0, 'the portal’s template never ran on the server');
  const root = document.createElement('div');
  document.body.append(root);
  root.innerHTML = markup.replaceAll('portal-ssr', 'portal-hy');
  const own = root.querySelector('p');
  const target = document.createElement('div');
  document.body.append(target);
  const warned = [];
  const original = console.warn;
  console.warn = (...a) => warned.push(a.map(String).join(' '));
  try {
    customElements.define('portal-hy', class extends HTMLElement {
      connectedCallback() { init(this, () => { portal(target, () => html`<aside>portaled</aside>`); return () => html`<p>own</p>`; }); }
    });
    await settle();
  } finally {
    console.warn = original;
  }
  assert.equal(root.querySelector('p') === own, true, 'the server’s <p> was adopted, not rebuilt');
  assert.deepEqual(shape(target), ['#c', 'aside', '#c'], 'one range on the client');
  assert.deepEqual(warned, [], 'no warning');
  root.remove();
  await settle();
  assert.deepEqual(shape(target), [], 'removed with its owner');
  target.remove();
});

test('without a renderer of this release, a portal draws nothing and says so once', async () => {
  const { portal: lone } = await load('renderer/portal');
  const warned = [];
  const original = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    const target = document.createElement('div');
    /** A fresh registry would need a fresh core; the hand-off's protocol is what is checked, so a foreign one stands in. */
    const { inserts } = await load('core');
    const saved = inserts.$H;
    inserts.$H = [999];
    const t = tag();
    define(t, () => { lone(target, html`<b>x</b>`); lone(target, html`<b>y</b>`); });
    const el = await mount(t);
    inserts.$H = saved;
    assert.equal(target.childNodes.length, 0, 'nothing drawn');
    assert.equal(warned.filter((m) => m.includes('portal-no-renderer')).length, 1, 'said once');
    el.remove();
    await settle();
  } finally {
    console.warn = original;
  }
});
