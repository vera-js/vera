/**
 * `async connectedCallback()` on the client, which is how a component that fetches is written.
 *
 * `@verajs/ssr` treats this as an expected shape — `renderToStringAsync` exists to await it, and
 * three fixtures and two suites cover it. **The client side had no test at all.**
 *
 * ## The constraint, deterministic since 2026-10-09
 *
 * A setup is the synchronous body of its `init(...)` call (R1). An ASYNC setup is supported — its part before the
 * first `await` is the window — and a hook made after the `await` finds no component and throws `no-owner`, which
 * rejects the setup and is reported once (`setup-rejected`), the same way whether or not another component connected
 * meanwhile. Before, the outcome depended on what else initialized during the suspension (Brian: async must be
 * predictable without reading docs).
 *
 * ## The rule
 *
 * **Await before `init()`, or inside an async setup with its hooks before the first `await`.** Both shapes render with
 * no warnings however their fetches interleave — the first rows below.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

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
        core.init({ host: this, shadow: 'open' }, () => {
          const store = core.createStore({ v: data });
          core.useEffect(() => { void store.v; });
          return () => html`<p>${store.v}</p>`;
        });
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

/**
 * The one form's async setup (R1): `init(this, async () => { …hooks…; await …; return render; })` is supported — the
 * part before the first `await` is the window. What still fails is a HOOK made after the `await`: no component is
 * being set up any more, so it throws `no-owner`, which rejects the setup, which is reported once as `setup-rejected`
 * (through the error chain, never an unhandled rejection) — the same way alone or overtaken. (The legacy rows here
 * were "`render()` after an `await` between init and render throws"; `render()` was removed in R2.)
 */
const reported = (run) => {
  const causes = [];
  const handler = (error) => causes.push(String(error?.message ?? error));
  core.wire({ on: 'error', fn: handler, priority: 79 });
  return Promise.resolve(run()).then(() => causes, (error) => { throw error; }).finally(() => {
    const chain = core.inserts.get('error');
    const at = chain.indexOf(handler);
    chain.splice(at, 1);
    chain._p.splice(at, 1);
  });
};

test('an async setup awaiting before its render renders — hooks before the await, the render after', async () => {
  customElements.define('await-inside', class extends dom.window.HTMLElement {
    connectedCallback() {
      core.init({ host: this, shadow: 'open' }, async () => {
        const store = core.createStore({ n: 1 });
        core.useEffect(() => { void store.n; });
        await Promise.resolve();
        return () => html`<p>${store.n}</p>`;
      });
    }
  });
  const element = dom.window.document.createElement('await-inside');
  const said = await quietly(async () => { app.appendChild(element); await settle(); });
  assert.equal(element.shadowRoot?.textContent.trim(), '1', 'it rendered once its promise settled');
  assert.deepEqual(said, [], 'with nothing to warn about');
});

test('a hook made AFTER the await in an async setup is reported once (no-owner, setup-rejected) and nothing renders', async () => {
  customElements.define('await-hook-solo', class extends dom.window.HTMLElement {
    connectedCallback() {
      core.init({ host: this, shadow: 'open' }, async () => {
        await Promise.resolve();
        core.useEffect(() => {});
        return () => html`<p>1</p>`;
      });
    }
  });
  const element = dom.window.document.createElement('await-hook-solo');
  const causes = await reported(async () => { app.appendChild(element); await settle(); });
  assert.equal(causes.length, 1, causes.join(' | '));
  assert.match(causes[0], /no-owner|no component being set up/);
  assert.equal(element.shadowRoot?.textContent.trim(), '', 'and renders nothing');
});

/** Two of them, interleaving: BOTH are reported — the outcome does not depend on which resumed first. */
test('two async setups making a hook after their await are both reported, whichever resumes first', async () => {
  const build = (delay) =>
    class extends dom.window.HTMLElement {
      connectedCallback() {
        core.init({ host: this, shadow: 'open' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          core.useEffect(() => {});
          return () => html`<p>x</p>`;
        });
      }
    };
  customElements.define('await-mid-a', build(20));
  customElements.define('await-mid-b', build(5));
  const a = dom.window.document.createElement('await-mid-a');
  const b = dom.window.document.createElement('await-mid-b');
  const causes = await reported(async () => { app.appendChild(a); app.appendChild(b); await settle(); });
  assert.equal(causes.length, 2, causes.join(' | '));
  assert.ok(causes.every((cause) => /no-owner|no component being set up/.test(cause)), causes.join(' | '));
});
