/**
 * **A hydrating app can be profiled** (2026-10-08). `@verajs/renderer/profiler` bundles its own renderer, and hydration
 * used to be a second one (`@verajs/renderer/hydrate`), so an app could have one or the other: a hydrating app reported
 * zero frames. Hydration is now a module wired BESIDE whichever renderer the app uses, so the profiler's renderer with
 * `hydration` adopts the server's markup — node identity kept — and the profile counts it sensibly: the adoption is a
 * frame and neither a create nor a rebuild (no template was instantiated), and the later render an update.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="c"><section><p>hi</p><b>1</b></section></div></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

test('wire([profiler renderer, hydration]): server markup adopted in place, and profiled', { skip: isProduction && 'the profiler is not built for production' }, async () => {
  const { wire, html } = await load('core');
  const profiler = await load('renderer/profiler');
  const { hydration } = await load('renderer/hydration');
  wire([profiler.renderer, hydration]);
  const container = dom.window.document.getElementById('c');
  const p = container.querySelector('p');
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  const view = (text, n) => html`<section><p>${text}</p><b>${n}</b></section>`;
  try {
    profiler.startProfiling();
    profiler.renderInto(view('hi', 1), container);
    assert.equal(container.querySelector('p'), p, 'adopted: the server node kept, by identity');
    profiler.renderInto(view('ho', 2), container);
    const report = profiler.stopProfiling();
    assert.deepEqual(said, [], 'no mismatch: it hydrated');
    assert.equal(container.querySelector('p'), p, 'and the update wrote into it');
    assert.equal(container.textContent, 'ho2');
    assert.equal(report.frames, 2, 'both renders observed — the profiler is not blind to a hydrating app');
    assert.equal(report.creates + report.rebuilds, 0, 'the adoption is neither a create nor a rebuild');
    assert.equal(report.updates, 1, 'the second render an update in place');
  } finally {
    console.warn = warn;
  }
});
