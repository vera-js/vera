/**
 * **Where a failure in component code goes** — reported from a real app moving to core 0.3.1 /
 * renderer 0.2.2: a throwing `&ref` skipped the `'error'` insert that a throwing effect reaches, so
 * an error boundary never saw it; and with no `'error'` handler wired, both reached only
 * `console.error`, so `window.onerror`, error trackers and test runners saw nothing while a
 * component had stopped updating.
 *
 * The contract now, for hooks and refs alike: the `'error'` chain if one is wired, handed the
 * COMPONENT being rendered; otherwise `reportError`, which fires the window's `error` event without
 * unwinding (one failure never stops its siblings); and off-browser, where there is no
 * `reportError`, the console. The ordering matters here — a wired handler cannot be unwired, so the
 * no-handler tests run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame',
  'Event', 'CustomEvent', 'MutationObserver',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const { html, init, render, useEffect } = core;
const frame = () => new Promise((resolve) => setTimeout(resolve, 40));

customElements.define('x-ref-throws', class extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<p &ref=${() => { throw new Error('ref failed'); }}>r</p><i>after</i>`);
  }
});
customElements.define('x-shadow-ref-throws', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p &ref=${() => { throw new Error('shadow ref failed'); }}>r</p>`);
  }
});
customElements.define('x-effect-throws', class extends HTMLElement {
  connectedCallback() {
    init(this);
    useEffect(() => { throw new Error('effect failed'); });
    render(() => html`<p>e</p>`);
  }
});

/** Captures `reportError` and `console.error` for one stretch of work. */
const watch = async (work) => {
  const reported = [];
  const printed = [];
  const realError = console.error;
  globalThis.reportError = (error) => reported.push(error.message);
  console.error = (...args) => printed.push(args.map(String).join(' '));
  try {
    await work();
  } finally {
    delete globalThis.reportError;
    console.error = realError;
  }
  return { reported, printed };
};

test('with no handler, a throwing ref goes to reportError — and the render carries on', async () => {
  const element = document.createElement('x-ref-throws');
  const { reported, printed } = await watch(async () => {
    document.body.append(element);
    await frame();
  });
  assert.deepEqual(reported, ['ref failed'], 'the window hears it, as page-error listeners need');
  assert.equal(element.querySelector('i')?.textContent, 'after', 'CONTROL: the render completed past the ref');
  if (!isProduction)
    assert.ok(printed.some((line) => line.startsWith('[vera] an element ref threw')), 'development names it');
  else assert.deepEqual(printed, [], 'production leaves the report to the platform');
  element.remove();
});

test('with no handler, a throwing hook goes to reportError too', async () => {
  const element = document.createElement('x-effect-throws');
  const { reported } = await watch(async () => {
    document.body.append(element);
    await frame();
  });
  assert.deepEqual(reported, ['effect failed']);
  element.remove();
});

test('off-browser, with no reportError, both still reach the console', async () => {
  const printed = [];
  const realError = console.error;
  console.error = (...args) => printed.push(args.map(String).join(' '));
  const ref = document.createElement('x-ref-throws');
  const effect = document.createElement('x-effect-throws');
  try {
    assert.equal(typeof globalThis.reportError, 'undefined', 'CONTROL: Node has no reportError');
    document.body.append(ref, effect);
    await frame();
  } finally {
    console.error = realError;
  }
  assert.ok(printed.some((line) => line.includes('ref failed')), 'the ref error is printed');
  assert.ok(printed.some((line) => line.includes('effect failed')), 'the hook error is printed');
  ref.remove();
  effect.remove();
});

test('a wired error insert receives a ref error with the component, as it does a hook error', async () => {
  const seen = [];
  core.wire({ on: 'error', fn: (error, element) => seen.push(`${error.message}@${element?.localName}`), priority: 40 });
  const light = document.createElement('x-ref-throws');
  const shadow = document.createElement('x-shadow-ref-throws');
  const effect = document.createElement('x-effect-throws');
  const { reported, printed } = await watch(async () => {
    document.body.append(light, shadow, effect);
    await frame();
  });
  assert.deepEqual(seen.sort(), [
    'effect failed@x-effect-throws',
    'ref failed@x-ref-throws',
    'shadow ref failed@x-shadow-ref-throws',
  ], 'every one reached the boundary, each with its component — a shadow root resolved to its host');
  assert.deepEqual(reported, [], 'a handled error is not reported again');
  assert.deepEqual(printed, [], 'nor printed');
});
