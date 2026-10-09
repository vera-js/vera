/**
 * **`hydrateSlots` wired without `slots` is refused before anything is touched** (`hydrate-slots-unwired`, code-system
 * phase 1, 2026-10-09 — the guard had no test). It reads the server's light-DOM statement through slots' capture seam;
 * with no slots there is nothing to read it with. A wiring state, so the diagnostic shape in development
 * (`[vera] hydrate-slots: <host> — …`); production keeps its short line, which the byte rule measured smaller.
 */
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const served = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr'; import { wire } from '@verajs/core';
  const { slots } = await import('@verajs/renderer/slots'); wire([slots]);
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/slot-card-ssr.js', 'file://' + process.cwd() + '/'), { children: '<h2 slot="header">H</h2>body' })).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text', 'DocumentFragment', 'MutationObserver', 'customElements', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[k] = dom.window[k];
const { wire, html } = await load('core');
const { renderInto, renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
const { hydrateSlots } = await load('renderer/hydrate-slots');
/** `slots` deliberately NOT wired. */
wire([renderer, hydration, hydrateSlots]);

test('hydrateSlots without slots: refused by code, the served markup untouched', () => {
  assert.match(served, /data-vm-light="1:/, 'CONTROL: a served light host');
  const wrap = dom.window.document.createElement('div');
  wrap.innerHTML = served;
  const host = dom.window.document.getElementById('root').appendChild(wrap.firstElementChild);
  const before = host.outerHTML;
  let error = null;
  try {
    renderInto(html`<article><header><slot name="header">fb</slot></header><main><slot>d</slot></main></article>`, host);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'it refused');
  if (isProduction) assert.equal(error.message, '[vera] hydrate-slots: no slots');
  else assert.match(error.message, /^\[vera\] hydrate-slots: <slot-card-ssr> — reads the light-DOM statement through `slots`, which is not wired\.[\s\S]*\(hydrate-slots-unwired\)$/);
  assert.equal(host.outerHTML, before, 'not one node touched');
});
