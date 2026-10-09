/**
 * **A light host changed by page code is redistributed by the next microtask — even when the opt-in `frameBudget`
 * scheduler's budget is spent.** Slots redistributes from its own observer, not through core's flush queue, so the budget that moves a
 * RENDER to the next frame never delays it (measured 2026-10-08 beside the render it does delay: after `await`, the
 * render stale, the slot current). The docs say "read it after `await`" for this case; this row keeps that true.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const core = await load('core');
const { renderer } = await load('renderer');
const { slots } = await load('renderer/slots');
core.wire([renderer, slots]);
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

test('with frameBudget opted in and spent, a render waits for the frame while a slot redistributes after `await`', async () => {
  const previous = core.setRenderScheduler(core.frameBudget);
  customElements.define('sb-host', class extends HTMLElement { connectedCallback() { core.init(this); core.render(() => core.html`<div><slot></slot></div>`); } });
  const spend = core.createStore({ go: 0 });
  const state = core.createStore({ n: 0 });
  const real = performance.now.bind(performance);
  /** Moves only forward with the real clock (a clock set ahead and restored would leave core's window in the future). */
  let now = real();
  performance.now = () => Math.max(now, real());
  try {
    customElements.define('sb-spend', class extends HTMLElement { connectedCallback() { core.init(this); core.useEffect(() => { if (spend.go) now += 5; }); core.mount(); } });
    customElements.define('sb-n', class extends HTMLElement { connectedCallback() { core.init(this); core.render(() => core.html`<p>${state.n}</p>`); } });
    const host = doc().createElement('sb-host');
    const n = doc().createElement('sb-n');
    doc().body.append(host, doc().createElement('sb-spend'), n);
    await frame();
    now = real() + 20; // a fresh budget window
    spend.go = 1;
    await Promise.resolve(); // a flush that "takes" 5 ms: the budget is spent
    state.n = 1;
    const b = doc().createElement('b');
    b.textContent = 'NEW';
    host.append(b);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(n.textContent, '0', 'CONTROL: the budget is spent — the render waits for the frame');
    assert.ok(host.querySelector('div').textContent.includes('NEW'), 'the slot redistributed after `await` regardless');
    await frame();
    assert.equal(n.textContent, '1', 'and the render landed on the frame');
  } finally {
    performance.now = real;
    core.setRenderScheduler(previous);
  }
});

function doc() { return dom.window.document; }
