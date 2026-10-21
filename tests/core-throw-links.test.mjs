/**
 * **What a render that THROWS leaves linked** (step 2 (d), 2026-10-21 — pinned as behavior, not changed): the failed
 * run keeps the links it made before the throw, so a write to what it read re-runs it — how a component whose render
 * failed RECOVERS when its data changes; the next successful run drops what it no longer reads, so nothing outlives it.
 * ("A throw commits no new links" was weighed in the step 2 plan and declined: it would make a broken render deaf to
 * the very write that fixes it.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
const { init, html, wire, createStore, flush } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);

test('a throwing render stays subscribed to what it read (it can recover); the next good render drops the stale link', () => {
  const report = globalThis.reportError;
  const error = console.error;
  globalThis.reportError = () => {};
  console.error = () => {};
  try {
    const S = createStore({ a: 1, b: 1, boom: false });
    let runs = 0;
    customElements.define('x-throw-links', class extends HTMLElement {
      connectedCallback() {
        init(this, () => () => {
          runs++;
          void S.a;
          if (S.boom) { void S.b; throw new Error('render throws (pinned)'); }
          return html`<b>${S.a}</b>`;
        });
      }
    });
    const el = document.createElement('x-throw-links');
    document.body.append(el);
    flush();
    assert.equal(runs, 1, 'CONTROL: rendered once');
    S.boom = true; flush();
    assert.equal(runs, 2, 'the throwing run ran');
    S.b = 2; flush();
    assert.equal(runs, 3, 'a write to what the FAILED run read re-runs it — recovery');
    S.boom = false; flush();
    assert.equal(runs, 4, 'recovered');
    S.b = 3; flush();
    assert.equal(runs, 4, 'the good run no longer reads b: the stale link is gone');
    el.remove();
  } finally {
    globalThis.reportError = report;
    console.error = error;
  }
});
