/**
 * User code throwing must not leave the framework unusable.
 *
 * There are diagnostics for a cleanup that threw, a ref that threw, a route that threw. A diagnostic
 * says the framework *noticed*; it does not say it *recovered*. The failure this guards against is a
 * flag left set or a queue left dirty by the throw, after which everything downstream silently stops
 * — which presents as "the app froze" and points at nothing.
 *
 * Every case is the same shape: do the normal thing, make user code throw once, then do the normal
 * thing again and require it to still work.
 *
 * ## Two things that make this test easy to write wrongly
 *
 * **Hooks must be registered between `init()` and the `render()` that ends setup.** Registered after,
 * every one is ignored — with a diagnostic saying so, which is the only reason the first draft of this
 * was caught. It reported 0 before and 0 after, which reads as "nothing recovered" and actually meant
 * "nothing ran".
 *
 * **Teardown needs a real custom element.** The second draft removed plain `<div>`s and no cleanup ran
 * at all, so the cleanup case reported perfect behaviour while measuring nothing. Each case below
 * asserts its control produced a non-zero count *before* anything is made to throw.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://x.test/', pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent', 'MutationObserver', 'ShadowRoot',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
const { html } = await load('renderer/tag');
core.wire([renderer]);

const frame = () => new Promise((resolve) => setTimeout(resolve, 25));
const app = dom.window.document.getElementById('app');

/** Swallows the errors the framework re-surfaces, so a failure here is an assertion and not noise. */
const quietly = async (work) => {
  const original = console.error;
  console.error = () => {};
  try { return await work(); } finally { console.error = original; }
};

test('a render function that throws does not stop the next render', async () => {
  const store = core.createStore({ n: 0 });
  let boom = false;
  const host = dom.window.document.createElement('div');
  app.appendChild(host);
  core.init(host, { mode: 'open' });
  core.render(() => {
    if (boom) throw new Error('user template threw');
    return html`<p>${store.n}</p>`;
  }, host);
  await frame();
  assert.equal(host.shadowRoot.textContent.trim(), '0', 'the control rendered');

  await quietly(async () => { boom = true; store.n = 1; await frame(); });
  boom = false;
  store.n = 2;
  await frame();
  assert.equal(host.shadowRoot.textContent.trim(), '2', 'a later state still renders');
});

test('an effect that throws stops neither its sibling nor the next run', async () => {
  const store = core.createStore({ n: 0 });
  const ran = { throwing: 0, quiet: 0 };
  let boom = false;
  const host = dom.window.document.createElement('div');
  app.appendChild(host);
  core.init(host, { mode: 'open' });
  core.useEffect(() => { ran.throwing++; store.n; if (boom) throw new Error('effect threw'); });
  core.useEffect(() => { ran.quiet++; store.n; });
  core.render(() => html`<p>${store.n}</p>`, host);
  await frame();
  assert.deepEqual(ran, { throwing: 1, quiet: 1 }, 'both effects ran once — the control');

  await quietly(async () => { boom = true; store.n = 1; await frame(); });
  assert.equal(ran.quiet, 2, 'the sibling still ran on the write that threw');

  boom = false;
  store.n = 2;
  await frame();
  assert.deepEqual(ran, { throwing: 3, quiet: 3 }, 'and both keep running afterwards');
});

/** `useSyncEffect` is documented as the sharp one, so it matters more that a throw is contained. */
test('and neither does a sync effect that throws', async () => {
  const store = core.createStore({ n: 0 });
  const ran = { throwing: 0, quiet: 0 };
  let boom = false;
  const host = dom.window.document.createElement('div');
  app.appendChild(host);
  core.init(host, { mode: 'open' });
  core.useSyncEffect(() => { ran.throwing++; store.n; if (boom) throw new Error('sync effect threw'); });
  core.useSyncEffect(() => { ran.quiet++; store.n; });
  core.render(() => html`<p>${store.n}</p>`, host);
  await frame();
  assert.deepEqual(ran, { throwing: 1, quiet: 1 }, 'both ran once — the control');

  await quietly(async () => {
    boom = true;
    try { store.n = 1; } catch { /* a sync effect may throw into whoever wrote */ }
    await frame();
  });
  boom = false;
  store.n = 2;
  await frame();
  assert.deepEqual(ran, { throwing: 3, quiet: 3 }, 'later writes still reach both');
});

test('a cleanup that throws stops neither its siblings nor the next element', async () => {
  const cleaned = [];
  const elements = [];

  class Leaky extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const name = this.getAttribute('name');
      core.useEffect(() => () => { cleaned.push(`${name}-1`); });
      core.useEffect(() => () => { cleaned.push(`${name}-2`); throw new Error(`cleanup ${name} threw`); });
      core.useEffect(() => () => { cleaned.push(`${name}-3`); });
      core.render(() => html`<p>${name}</p>`, this);
    }
  }
  customElements.define('leaky-thing', Leaky);

  for (const name of ['a', 'b']) {
    const element = dom.window.document.createElement('leaky-thing');
    element.setAttribute('name', name);
    app.appendChild(element);
    elements.push(element);
  }
  await frame();
  assert.deepEqual(cleaned, [], 'nothing has been torn down yet — the control');

  await quietly(async () => {
    for (const element of elements) element.remove();
    await frame();
  });

  assert.deepEqual(
    cleaned, ['a-1', 'a-2', 'a-3', 'b-1', 'b-2', 'b-3'],
    'every cleanup ran, on both elements, across the one that threw'
  );
  for (const element of elements) assert.equal(element.isConnected, false, 'and the element still came out');
});

/** The point of all of the above: the framework is still usable, not merely still complaining. */
test('and a brand-new component still mounts after all of that', async () => {
  const element = dom.window.document.createElement('leaky-thing');
  element.setAttribute('name', 'later');
  app.appendChild(element);
  await frame();
  assert.equal(element.shadowRoot.textContent.trim(), 'later');
});
