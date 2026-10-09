/**
 * **The scheduler: one queue, one flush** (Brian, 2026-10-08). Every deferred hook pass joins one queue that one
 * microtask drains — within a per-frame budget — in a fixed order: layout effects, then renders, then effects, and
 * parent-first. These rows pin what that buys: after `await` the DOM and its effects are done; a child re-rendered by
 * its parent's new props renders ONCE; a measure-then-set lands within one flush, before paint; `flush()` drains on
 * demand; and past the budget a flush waits for a frame. The budget is driven by an injected clock — never by real
 * milliseconds, which Firefox and WebKit coarsen and CI does not honor.
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
core.wire([renderer]);
const { html } = core;
const doc = dom.window.document;
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));
let seq = 0;
const tag = () => `x-flush-${seq++}`;

test('after `await`, the DOM and its effects are done — one write, one microtask', async () => {
  const state = core.createStore({ n: 0 });
  const seen = [];
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useEffect(() => { void state.n; seen.push(this.textContent); });
      core.render(() => html`<p>${state.n}</p>`);
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  state.n = 1;
  assert.equal(el.textContent, '0', 'CONTROL: nothing ran inside the write');
  await Promise.resolve();
  assert.equal(el.textContent, '1', 'the render landed');
  assert.equal(seen.at(-1), '1', 'and the effect ran after it, seeing the new DOM');
  el.remove();
});

test('order within a flush: renders, then layout effects, then effects (React\'s order) — and a hundred writes are one flush', async () => {
  const state = core.createStore({ n: 0 });
  const order = [];
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useEffect(() => { void state.n; order.push('effect'); });
      core.useLayoutEffect(() => { void state.n; order.push('layout'); });
      core.render(() => { order.push('render'); return html`<p>${state.n}</p>`; });
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  order.length = 0;
  for (let i = 0; i < 100; i++) state.n++;
  await Promise.resolve();
  assert.deepEqual(order, ['render', 'layout', 'effect'], 'each once, in that order');
  el.remove();
});

test('a child re-rendered by its parent\'s new props renders ONCE — parent first', async () => {
  const state = core.createStore({ n: 0 });
  const renders = { parent: 0, child: 0 };
  /** Literal tags: one call site, one template — a template built per render is a rebuild, not an update. */
  const child = 'x-flush-child';
  const parent = 'x-flush-parent';
  customElements.define(child, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      /** Reads the same store as its parent AND the prop the parent delivers. */
      core.render(() => { renders.child++; return html`<i>${state.n}/${this.n}</i>`; });
    }
  });
  customElements.define(parent, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.render(() => { renders.parent++; return html`<b>${state.n}</b><x-flush-child .n=${state.n}></x-flush-child>`; });
    }
  });
  const el = doc.createElement(parent);
  doc.body.append(el);
  await frame();
  renders.parent = renders.child = 0;
  state.n = 1;
  await Promise.resolve();
  assert.equal(el.querySelector('i').textContent, '1/1', 'CONTROL: both settled');
  assert.deepEqual(renders, { parent: 1, child: 1 }, 'the child ran once, after its parent — not once for the store and again for the prop');
  el.remove();
});

test('a measure-then-set settles within ONE flush — before paint, no frame in between', async () => {
  const state = core.createStore({ text: 'hi', width: 0 });
  let frames = 0;
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      /** Measures what was just rendered (its text length stands in for a layout read) and stores it. */
      core.useEffect(() => { void state.text; state.width = this.querySelector('span').textContent.length; });
      core.render(() => html`<span>${state.text}</span><b>${state.width}</b>`);
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await frame();
  /** One frame request, canceled after: a chain of them would keep the process alive forever. */
  const id = dom.window.requestAnimationFrame(() => { frames++; });
  const before = frames;
  state.text = 'hello';
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(el.querySelector('b').textContent, '5', 'the second render, with the measurement, already landed');
  assert.equal(frames, before, 'with no frame in between — the measured value is what gets painted');
  dom.window.cancelAnimationFrame(id);
  el.remove();
});

test('`flush()` drains every queued pass, synchronously', () => {
  const state = core.createStore({ n: 0 });
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.render(() => html`<p>${state.n}</p>`);
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  state.n = 7;
  assert.equal(el.textContent, '0', 'CONTROL: queued');
  core.flush();
  assert.equal(el.textContent, '7', 'drained at once');
  el.remove();
});

test('past the budget, the next flush waits for a frame — driven by an injected clock', async () => {
  const state = core.createStore({ n: 0 });
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.render(() => html`<p>${state.n}</p>`);
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await frame();
  const real = performance.now.bind(performance);
  /**
   * Starts at the REAL time and only moves forward with it — a clock set ahead and then restored leaves core's budget
   * window in the future, and every later flush waits for a frame (found writing these rows).
   */
  let now = real() + 20; // a fresh window
  performance.now = () => Math.max(now, real());
  try {
    /** A flush that "takes" 5 ms: the clock advances inside it, as real work would. */
    const slow = core.createStore({ go: 0 });
    const spender = tag();
    customElements.define(spender, class extends HTMLElement {
      connectedCallback() {
        core.init(this);
        core.useEffect(() => { if (slow.go) now += 5; });
        core.mount();
      }
    });
    const s = doc.createElement(spender);
    doc.body.append(s);
    /** CONTROL first: with the budget untouched, a write lands at once. */
    state.n = 9;
    await Promise.resolve();
    assert.equal(el.textContent, '9', 'CONTROL: within the budget the flush is a microtask');
    slow.go = 1;
    await Promise.resolve();
    state.n = 1;
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(el.textContent, '9', 'the budget is spent: after `await` the DOM is NOT yet current (documented)');
    core.flush();
    assert.equal(el.textContent, '1', '`flush()` makes it current at once — what the docs tell code that must read now');
    state.n = 2;
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(el.textContent, '1', 'CONTROL: still within the spent window, the next write waits again');
    await frame();
    assert.equal(el.textContent, '2', 'and lands on the frame');
    s.remove();
  } finally {
    performance.now = real;
  }
  el.remove();
});

test('passes queued OUT of order are sorted: a child woken first still runs after its parent, once', async () => {
  const own = core.createStore({ x: 0 });
  const shared = core.createStore({ y: 0 });
  const renders = { parent: 0, child: 0 };
  customElements.define('x-flush-kid', class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.render(() => { renders.child++; return html`<i>${own.x}/${this.y}</i>`; });
    }
  });
  customElements.define('x-flush-mom', class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.render(() => { renders.parent++; return html`<x-flush-kid .y=${shared.y}></x-flush-kid>`; });
    }
  });
  const el = doc.createElement('x-flush-mom');
  doc.body.append(el);
  await frame();
  renders.parent = renders.child = 0;
  own.x = 1; // the CHILD is queued first
  shared.y = 1; // then its parent, which hands it a new prop
  await Promise.resolve();
  assert.equal(el.querySelector('i').textContent, '1/1', 'CONTROL: both settled');
  assert.deepEqual(renders, { parent: 1, child: 1 }, 'sorted parent-first: the child ran once, after the parent');
  el.remove();
});

test('a window with no frames still settles a held loop — through the timer', async () => {
  const frameless = new JSDOM('<!doctype html><body></body>');
  assert.equal(typeof frameless.window.requestAnimationFrame, 'undefined', 'CONTROL: no frames here');
  const el = frameless.window.document.createElement('div');
  frameless.window.document.body.append(el);
  const state = core.createStore({ n: 0 });
  core.init(el);
  core.useEffect(() => { if (state.n > 0 && state.n < 5) state.n++; });
  core.mount();
  state.n = 1;
  await Promise.resolve();
  assert.equal(state.n, 3, 'two runs in the flush, then held');
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(state.n, 5, 'and the held runs came back on the timer, with no frame to wait for');
});

test('an element whose window has gone (a closed pop-out) still settles a held loop — and nothing throws', async () => {
  /** A document with no window: `defaultView` is null, as it is for a closed pop-out's or a removed iframe's. */
  const orphan = doc.implementation.createHTMLDocument('');
  assert.equal(orphan.defaultView, null, 'CONTROL: no window here');
  const el = orphan.createElement('div');
  orphan.body.append(el);
  const state = core.createStore({ n: 0 });
  core.init(el);
  core.useEffect(() => { if (state.n > 0 && state.n < 5) state.n++; });
  core.mount();
  state.n = 1;
  await Promise.resolve();
  assert.equal(state.n, 3, 'CONTROL: two runs in the flush, then held');
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(state.n, 5, 'the held runs came back on the global frame or the timer');
});

test('on MOUNT, the first useLayoutEffect sees the DOM the first render made — React\'s guarantee', async () => {
  const seen = [];
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useLayoutEffect(() => { seen.push(this.querySelector('p')?.textContent ?? 'no DOM yet'); });
      core.render(() => html`<p>first</p>`);
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await Promise.resolve();
  assert.equal(el.textContent, 'first', 'CONTROL: the first render landed');
  assert.deepEqual(seen, ['first'], 'the layout effect ran once, after the render, and saw its DOM');
  el.remove();
});

test('a useLayoutEffect measuring the NEW DOM and storing it settles within one flush — no frame between', async () => {
  const state = core.createStore({ text: 'hi', width: 0 });
  let frames = 0;
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      /** Its text length stands in for a layout read: what a tooltip ported from React does. */
      core.useLayoutEffect(() => { void state.text; state.width = this.querySelector('span').textContent.length; });
      core.render(() => html`<span>${state.text}</span><b>${state.width}</b>`);
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await frame();
  assert.equal(el.querySelector('b').textContent, '2', 'CONTROL: the mount measured the first render');
  const id = dom.window.requestAnimationFrame(() => { frames++; });
  const before = frames;
  state.text = 'hello';
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(el.querySelector('b').textContent, '5', 'it measured THIS render (5), not the previous one (2)');
  assert.equal(frames, before, 'and the measured value landed with no frame in between');
  dom.window.cancelAnimationFrame(id);
  el.remove();
});

test('hooks of one priority on one component run in the order it registered them', async () => {
  const state = core.createStore({ n: 0 });
  const order = [];
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useLayoutEffect(() => { void state.n; order.push('a'); });
      core.useLayoutEffect(() => { void state.n; order.push('b'); });
      core.useEffect(() => { void state.n; order.push('c'); });
      core.useEffect(() => { void state.n; order.push('d'); });
      core.mount();
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await Promise.resolve();
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], 'CONTROL: the first pass ran all four, in order');
  order.length = 0;
  state.n = 1;
  await Promise.resolve();
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], 'and an update keeps registration order within each priority');
  el.remove();
});

test('useHook joins the flush at its priority — at 25, before the render, seeing the OLD DOM', async () => {
  const state = core.createStore({ n: 0 });
  const seen = [];
  const order = [];
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useHook((change, first) => {
        void state.n;
        if (!first) { order.push('snapshot'); seen.push(this.textContent); }
      }, 25);
      core.useHook((change, first) => { void state.n; if (!first) order.push('65'); }, 65);
      core.useLayoutEffect(() => { void state.n; order.push('layout'); });
      core.useEffect(() => { void state.n; order.push('effect'); });
      core.render(() => { order.push('render'); return html`<p>${state.n}</p>`; });
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await Promise.resolve();
  order.length = 0;
  for (let i = 1; i <= 3; i++) state.n = i;
  assert.deepEqual(order, [], 'CONTROL: nothing ran inside the writes — it is scheduled, not synchronous');
  await Promise.resolve();
  assert.deepEqual(order, ['snapshot', 'render', 'layout', '65', 'effect'], 'once each, in priority order');
  assert.deepEqual(seen, ['0'], 'the 25 hook read the DOM before the render changed it');
  el.remove();
});

test('a useHook\'s returned function is its cleanup — before its next run, and on removal', async () => {
  const state = core.createStore({ n: 0 });
  const log = [];
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useHook(() => { const n = state.n; log.push(`run ${n}`); return () => log.push(`clean ${n}`); }, 65);
      core.mount();
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await Promise.resolve();
  state.n = 1;
  await Promise.resolve();
  el.remove();
  assert.deepEqual(log, ['run 0', 'clean 0', 'run 1', 'clean 1']);
});

test('createHook, the raw primitive, runs inside every write it hears — unbatched', () => {
  const state = core.createStore({ n: 0 });
  const runs = [];
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.createHook({ priority: 65, callback: (change, first) => { void state.n; if (!first) runs.push(state.n); } });
      core.mount();
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  state.n = 1;
  state.n = 2;
  assert.deepEqual(runs, [1, 2], 'synchronous, once per write');
  el.remove();
});

test('useHook and createHook take `element` alike: outside setup, the element given owns the hook and its cleanup', async () => {
  const state = core.createStore({ n: 0 });
  const log = [];
  /** A custom element: a plain `div` never hears its own removal (no `disconnectedCallback`), so cleanup would not run. */
  const name = tag();
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.mount();
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  /**
   * Called after setup: with no element being set up, only the one passed owns each hook — and nothing runs a first
   * pass for a hook made after `mount()`, so both return the hook and the caller runs it, which subscribes it.
   */
  const scheduled = core.useHook(() => { const n = state.n; log.push(`scheduled ${n}`); return () => log.push(`clean ${n}`); }, 65, el);
  const raw = core.createHook({ element: el, priority: 65, callback: () => { log.push(`raw ${state.n}`); } });
  assert.ok(typeof scheduled === 'function' && typeof raw === 'function', 'CONTROL: both accepted the element as owner');
  scheduled(undefined, true);
  raw(undefined, true);
  log.length = 0;
  state.n = 1;
  assert.deepEqual(log, ['raw 1'], 'the raw hook ran inside the write');
  await Promise.resolve();
  assert.deepEqual(log, ['raw 1', 'clean 0', 'scheduled 1'], 'the scheduled one ran in the flush, owned by `el`');
  el.remove();
  assert.deepEqual(log.at(-1), 'clean 1', 'and removing its owner ran its cleanup');
});
