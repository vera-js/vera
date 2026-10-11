/**
 * **Setting a component up again in place retires its previous generation completely** (found 2026-10-10, R2's inventory
 * with vera-5a). A removal ran a generation's effect cleanups; a re-init on a LIVE element — `init(this, s1)` then
 * `init(this, s2)`, or a setup calling `init` again — only replaced the cleanup set, so s1's interval or listener
 * outlived its hooks. Both paths now go through one `retireGeneration`: s1's cleanups run (a throwing one is reported,
 * the rest still run), s1's subscriptions leave the store, and s2 is the component.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
const { init, html, wire, createStore, useEffect, inserts } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;

test("a sequential re-init runs the first generation's cleanup once, and the second setup is the component", async () => {
  const store = createStore({ n: 1 });
  const ran = { s1Cleanup: 0, s1Renders: 0, s2Renders: 0 };
  const tag = `ri-seq-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init(this, () => {
        useEffect(() => () => { ran.s1Cleanup++; });
        return () => { ran.s1Renders++; return html`<p>s1 ${store.n}</p>`; };
      });
      init(this, () => () => { ran.s2Renders++; return html`<p>s2 ${store.n}</p>`; });
    }
  });
  const el = doc.createElement(tag);
  doc.body.append(el);
  await tick();
  assert.equal(ran.s1Cleanup, 1, "s1's cleanup ran when s2 took over");
  assert.equal(el.textContent, 's2 1', 'CONTROL: s2 is the component');
  const s1Before = ran.s1Renders;
  store.n = 2;
  await tick();
  assert.equal(ran.s1Renders, s1Before, "s1's render no longer answers a write");
  assert.equal(el.textContent, 's2 2', 's2 does');
  el.remove();
  await tick();
  assert.equal(ran.s1Cleanup, 1, "and s1's cleanup is never run twice");
});

test("a throwing cleanup does not abort the re-init: it is reported once, the next cleanup runs, s2 renders", async () => {
  const reported = [];
  const handler = (error) => reported.push(error.message);
  wire({ on: 'error', fn: handler, priority: 78 });
  const ran = { second: 0 };
  const tag = `ri-throw-${seq++}`;
  try {
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        init(this, () => {
          useEffect(() => () => { throw new Error('first cleanup threw'); });
          useEffect(() => () => { ran.second++; });
          return () => html`<p>s1</p>`;
        });
        init(this, () => () => html`<p>s2</p>`);
      }
    });
    const el = doc.createElement(tag);
    doc.body.append(el);
    await tick();
    assert.deepEqual(reported, ['first cleanup threw'], 'reported once, through the error chain');
    assert.equal(ran.second, 1, 'the next cleanup still ran');
    assert.equal(el.textContent, 's2', 's2 rendered');
    el.remove();
  } finally {
    const chain = inserts.get('error');
    const at = chain.indexOf(handler);
    chain.splice(at, 1);
    chain._p.splice(at, 1);
  }
});

/** `init-twice`, moved from the legacy window (R2's inventory #3): the one form's trigger set is exactly the legacy's. */
const said = async (run) => {
  const lines = [];
  const warn = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  try { await run(); } finally { console.warn = warn; }
  return lines.filter((line) => line.includes('init-twice'));
};
const isDev = !(await import('./dist.mjs')).isProduction;

test('init on its own host from INSIDE its setup is named once in development (init-twice)', async () => {
  const tag = `ri-nested-${seq++}`;
  const lines = await said(async () => {
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        init(this, (host) => {
          useEffect(() => {});
          init(host, () => () => html`<p>inner</p>`);
          return () => html`<p>outer</p>`;
        });
      }
    });
    doc.body.append(doc.createElement(tag));
    await tick();
  });
  assert.equal(lines.length, isDev ? 1 : 0, lines.join(' | '));
});

test('a SEQUENTIAL re-init, and a reconnect, are not init-twice', async () => {
  const tag = `ri-quiet-${seq++}`;
  const lines = await said(async () => {
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        init(this, () => { useEffect(() => {}); return () => html`<p>s1</p>`; });
        init(this, () => () => html`<p>s2</p>`);
      }
    });
    const el = doc.createElement(tag);
    doc.body.append(el);
    await tick();
    el.remove();
    await tick();
    doc.body.append(el);
    await tick();
    assert.equal(el.textContent, 's2', 'CONTROL: it reconnected and rendered');
    el.remove();
  });
  assert.deepEqual(lines, []);
});
