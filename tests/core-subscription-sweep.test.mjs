/**
 * **The dead-subscription sweep** (R1 piece 4). A removed component's hooks are collected, but the `WeakRef`s naming them
 * stayed in every key's subscriber Set until that key was WRITTEN — so a key never written (config, a locale) kept one
 * dead entry per component that ever read it, for the life of the store (measured: 50 542 at 50k components, ~90 B
 * each). `track` now sweeps a Set when it grows to its limit and doubles the limit from what is left.
 *
 * Two rows. CORRECTNESS, in this process: a sweep never drops a LIVE subscriber. RETENTION, in a child process run with
 * `--expose-gc` — the one exception to "tests do not force collection" (Brian, 2026-10-10): there gc is the measuring
 * instrument, alone in its own process, with both controls (a dropped object that must die, live readers that must
 * stay), never a crutch inside the logic under test. Counted with `v8.queryObjects`: what grows is WeakRef OBJECTS, so
 * counting surviving components would read clean while the store grows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
const { init, html, wire, createStore } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a sweep never drops a live subscriber — 300 readers past several limits all redraw on one write', async () => {
  const config = createStore({ label: 'a' });
  customElements.define('sw-row', class extends HTMLElement {
    connectedCallback() { init(this, () => () => html`<i>${config.label}</i>`); }
  });
  const host = doc.createElement('div');
  doc.body.append(host);
  /** 300 live readers: the Set crosses 32, 64, 128 and 256, sweeping at each with nothing dead to drop. */
  for (let i = 0; i < 300; i++) host.append(doc.createElement('sw-row'));
  await tick();
  assert.ok([...host.children].every((el) => el.textContent === 'a'), 'CONTROL: every reader rendered');
  config.label = 'b';
  await tick();
  assert.equal([...host.children].filter((el) => el.textContent === 'b').length, 300, 'every one redrew');
  host.remove();
});

/** The child: N components churned in batches, gc between; `mode` = never (a key never written) | noread (the baseline). */
const child = (mode) => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  import v8 from 'node:v8';
  const dom = new JSDOM('<!doctype html><body></body>');
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
    globalThis[k] = dom.window[k] ?? globalThis[k];
  const { load } = await import('./tests/dist.mjs');
  const { init, html, wire, createStore } = await load('core');
  const { renderer } = await load('renderer');
  wire([renderer]);
  const config = createStore({ label: 'x' });
  const read = ${JSON.stringify(mode)} === 'never';
  customElements.define('g-row', class extends HTMLElement { connectedCallback() { init(this, () => () => (read ? html\`<i>\${config.label}</i>\` : html\`<i>x</i>\`)); } });
  customElements.define('g-keep', class extends HTMLElement { connectedCallback() { init(this, () => () => html\`<b>\${config.label}</b>\`); } });
  const settle = () => new Promise((r) => setImmediate(r));
  const gc = async () => { for (let i = 0; i < 4; i++) { global.gc(); await settle(); } };
  const churn = document.createElement('div'), keep = document.createElement('div');
  document.body.append(churn, keep);
  for (let i = 0; i < 100; i++) keep.append(document.createElement('g-keep'));
  await settle();
  const dropped = new WeakRef({ plain: true });
  for (let i = 0; i < 5000; i += 100) {
    for (let j = 0; j < 100; j++) churn.append(document.createElement('g-row'));
    await settle();
    churn.replaceChildren();
    await settle();
    await gc();
  }
  process.stdout.write(JSON.stringify({
    weakRefs: v8.queryObjects(WeakRef, { format: 'count' }),
    droppedDied: dropped.deref() === undefined,
    keptLive: [...keep.children].every((el) => el.textContent === 'x'),
  }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env } }));

test('a key never written keeps its dead subscribers under 2 × the peak live count, not one per component ever made', () => {
  const never = child('never');
  const baseline = child('noread');
  assert.ok(never.droppedDied && baseline.droppedDied, 'CONTROL: gc ran (a dropped plain object died)');
  assert.ok(never.keptLive && baseline.keptLive, 'CONTROL: the 100 live readers are still subscribed');
  /** Peak live readers of the key: 100 churned + 100 kept. Unswept, the excess is ~5000 — one per component churned. */
  const excess = never.weakRefs - baseline.weakRefs;
  assert.ok(excess > 0, `CONTROL: the count sees subscribers at all (${excess})`);
  assert.ok(excess <= 2 * 200 + 32, `dead subscribers bounded: ${excess} over the baseline's ${baseline.weakRefs}`);
});
