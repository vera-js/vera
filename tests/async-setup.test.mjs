/**
 * `async connectedCallback()` on the client, which is how a component that fetches is written.
 *
 * `@verajs/ssr` treats this as an expected shape — `renderToStringAsync` exists to await it, and
 * three fixtures and two suites cover it. **The client side had no test at all.**
 *
 * ## The constraint, and since 2026-10-09 a deterministic one
 *
 * Setup is one synchronous block: `init()` starts it and it ends at the end of that microtask turn. A hook,
 * `render()` or `mount()` after an `await` in setup therefore finds no component and THROWS (`no-owner`, every
 * build) — the same way whether or not another component connected meanwhile. Before, the outcome depended on
 * what else initialized during the suspension: alone it worked, overtaken it rendered nothing (Brian: async must be
 * predictable without reading docs).
 *
 * ## The rule
 *
 * **Await before `init()`, never between `init()` and `render()`.** Two components written that way
 * both render, with no warnings, however their fetches interleave — which is the case that matters and
 * the first assertion below.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://x.test/', pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame',
  'MutationObserver', 'ShadowRoot',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
const { html } = await load('renderer/tag');
core.wire([renderer]);

const app = dom.window.document.getElementById('app');
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 30)); };
const quietly = async (work) => {
  const said = [];
  const original = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try { await work(); } finally { console.warn = original; }
  return said;
};

test('awaiting before init lets concurrent async components both render', async () => {
  /** Deliberately different delays, so the two resume out of the order they mounted in. */
  const build = (value, delay) =>
    class extends dom.window.HTMLElement {
      async connectedCallback() {
        const data = await new Promise((resolve) => setTimeout(() => resolve(value), delay));
        core.init(this, { mode: 'open' });
        const store = core.createStore({ v: data });
        core.useEffect(() => { void store.v; });
        core.render(() => html`<p>${store.v}</p>`);
      }
    };
  customElements.define('await-first-a', build('A', 20));
  customElements.define('await-first-b', build('B', 5));

  const a = dom.window.document.createElement('await-first-a');
  const b = dom.window.document.createElement('await-first-b');
  const said = await quietly(async () => {
    app.appendChild(a);
    app.appendChild(b);
    await settle();
  });

  assert.equal(a.shadowRoot?.textContent.trim(), 'A', 'the slower one rendered');
  assert.equal(b.shadowRoot?.textContent.trim(), 'B', 'and so did the faster one');
  assert.deepEqual(said, [], 'with nothing to warn about');
});

test('a single component awaiting between init and render now throws — it no longer works by luck', async () => {
  customElements.define('await-solo', class extends dom.window.HTMLElement {
    connectedCallback() {
      this.ready = (async () => {
        core.init(this, { mode: 'open' });
        await Promise.resolve();
        core.render(() => html`<p>1</p>`);
      })();
    }
  });
  const element = dom.window.document.createElement('await-solo');
  app.appendChild(element);
  await assert.rejects(element.ready, /no-owner|no component being set up/, 'alone, it throws — as it would if overtaken');
  assert.equal(element.shadowRoot?.textContent.trim(), '', 'and renders nothing');
});

/** Two of them, interleaving: BOTH throw — the outcome no longer depends on which resumed first. */
test('two components awaiting between init and render both throw, whichever resumes first', async () => {
  const build = (delay) =>
    class extends dom.window.HTMLElement {
      connectedCallback() {
        this.ready = (async () => {
          core.init(this, { mode: 'open' });
          await new Promise((resolve) => setTimeout(resolve, delay));
          core.render(() => html`<p>x</p>`);
        })();
      }
    };
  customElements.define('await-mid-a', build(20));
  customElements.define('await-mid-b', build(5));
  const a = dom.window.document.createElement('await-mid-a');
  const b = dom.window.document.createElement('await-mid-b');
  app.appendChild(a);
  app.appendChild(b);
  await assert.rejects(b.ready, /no-owner|no component being set up/, 'the one that resumed first');
  await assert.rejects(a.ready, /no-owner|no component being set up/, 'and the one it would have overtaken');
});
