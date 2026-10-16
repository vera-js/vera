/**
 * **A flush that goes out of order is REGROUPED by priority in linear time, never sorted** (work queue 6, A11,
 * 2026-10-16). A write read by components that each render AND run an effect queues render, effect, render, effect…,
 * so the single queue went out of order at every second pass and every such flush copied and sorted it. Now the rest
 * is regrouped — one walk per priority present, keeping creation order — and a flush in order (render-only) runs exactly
 * the path it ran before. Two rows: the ORDER (vera-5a — the case where order matters: an effect writing state its own
 * render reads), and the cost the change removes (no sort at all on that flood). The rare same-priority case where
 * creation order IS broken is pinned in core-hook-order ("past 2^53 / 1e9 … orders by creation").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key] ?? globalThis[key];
const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;

test('an effect that writes what its own render reads: that render runs again BEFORE the next component’s effect', async () => {
  const order = [];
  const shared = core.createStore({ n: 0 });
  const tag = `sb-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      const name = this.dataset.name;
      const own = core.createStore({ v: 0 });
      core.init(this, () => {
        core.useEffect(() => {
          void shared.n;
          order.push(`effect ${name}`);
          /** A's effect, on the shared write, writes what A's render reads (read untracked: the effect hears only `shared.n`). */
          if (name === 'A' && shared.n === 1 && core.untrack(() => own.v) === 0) own.v = 1;
        });
        return () => { order.push(`render ${name} v${own.v} n${shared.n}`); return core.html`<p>${shared.n}${own.v}</p>`; };
      });
    }
  });
  const make = (name) => { const el = doc.createElement(tag); el.dataset.name = name; return el; };
  const a = make('A');
  const b = make('B');
  doc.body.append(a, b);
  await tick();
  order.length = 0;
  shared.n = 1;
  await tick();
  assert.deepEqual(order, [
    'render A v0 n1',
    'render B v0 n1',
    'effect A',
    'render A v1 n1',
    'effect B',
  ], 'renders before effects, and the render an effect queued before the effects still waiting');
  a.remove();
  b.remove();
});

test('a write waking components that each render AND run an effect sorts nothing', async () => {
  const state = core.createStore({ n: 0 });
  const tag = `sb-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      core.init(this, () => {
        core.useEffect(() => { void state.n; });
        return () => core.html`<i>${state.n}</i>`;
      });
    }
  });
  const root = doc.createElement('div');
  doc.body.append(root);
  for (let i = 0; i < 200; i++) root.append(doc.createElement(tag));
  await tick();
  const sort = Array.prototype.sort;
  let sorted = 0;
  Array.prototype.sort = function (...args) { sorted += this.length; return sort.apply(this, args); };
  try {
    state.n = 1;
    await tick();
  } finally {
    Array.prototype.sort = sort;
  }
  assert.ok([...root.children].every((el) => el.textContent === '1'), 'CONTROL: every component rendered the write');
  assert.equal(sorted, 0, 'no pass was sorted');
  root.remove();
});
