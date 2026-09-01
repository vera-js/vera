/**
 * `async connectedCallback()` on the client, which is how a component that fetches is written.
 *
 * `@verajs/ssr` treats this as an expected shape — `renderToStringAsync` exists to await it, and
 * three fixtures and two suites cover it. **The client side had no test at all.**
 *
 * ## The constraint, which is real and cheap
 *
 * `currentInstance` is a single slot, not a stack: `init()` sets it and the `render()`/`mount()` that
 * closes setup clears it. So a second component calling `init()` overwrites the first's slot — and it
 * does that immediately, not at commit. An `await` between `init()` and `render()` therefore loses the
 * component whenever anything else initialises while it is suspended, which on a page of async cards
 * is every time.
 *
 * That is deliberate and the framework says so in the diagnostic itself: *"it runs once,
 * synchronously, inside connectedCallback. Calling it twice, after an `await`, or from a handler finds
 * nothing to close."* This suite pins the behaviour and both diagnostics, since the rule was stated
 * only in a runtime warning and only where someone had already hit it.
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

test('and a single component may still await between init and render', async () => {
  customElements.define('await-solo', class extends dom.window.HTMLElement {
    async connectedCallback() {
      core.init(this, { mode: 'open' });
      await Promise.resolve();
      const store = core.createStore({ n: 1 });
      core.render(() => html`<p>${store.n}</p>`);
      this._store = store;
    }
  });
  const element = dom.window.document.createElement('await-solo');
  const said = await quietly(async () => { app.appendChild(element); await settle(); });

  assert.equal(element.shadowRoot?.textContent.trim(), '1', 'nothing else claimed the slot');
  assert.deepEqual(said, [], 'so there is nothing to report');
  element._store.n = 2;
  await settle();
  assert.equal(element.shadowRoot?.textContent.trim(), '2', 'and it is reactive');
});

/**
 * The failing shape, pinned so the diagnostics keep describing it. Nothing here is a defect: a single
 * slot is the cheap design, and the warning names the cause. What must not happen is this becoming
 * silent.
 */
test('but awaiting between init and render loses whichever component is overtaken', async () => {
  const build = (value, delay) =>
    class extends dom.window.HTMLElement {
      async connectedCallback() {
        core.init(this, { mode: 'open' });
        await new Promise((resolve) => setTimeout(resolve, delay));
        const store = core.createStore({ v: value });
        core.useEffect(() => { void store.v; });
        core.render(() => html`<p>${store.v}</p>`);
      }
    };
  customElements.define('await-mid-a', build('A', 20));
  customElements.define('await-mid-b', build('B', 5));

  const a = dom.window.document.createElement('await-mid-a');
  const b = dom.window.document.createElement('await-mid-b');
  const said = await quietly(async () => {
    app.appendChild(a);
    app.appendChild(b);
    await settle();
  });

  assert.equal(b.shadowRoot?.textContent.trim(), 'B', 'the one that resumed first still has its slot');
  assert.equal(a.shadowRoot?.textContent.trim(), '', 'the one it overtook rendered nothing');

  if (isProduction) return;
  assert.ok(said.some((line) => /hook ignored/.test(line)), 'its hook was refused');
  assert.ok(
    said.some((line) => /no component is being set up/.test(line) && /after an `await`/.test(line)),
    'and its render named the await as the cause'
  );
});
