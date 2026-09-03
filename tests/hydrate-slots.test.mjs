/**
 * Light-DOM slot HYDRATION — REAL @verajs/ssr distributed markup (subprocess, its shims own
 * globals) adopted by the real hydrate build + slots module in jsdom. The promise: the server's
 * distributed DOM SURVIVES (node identity preserved — no re-render), and the slot system comes
 * alive (fallback returns on removal, re-slotting works) exactly as a fresh client render.
 */
import { load } from './dist.mjs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

/** Server: render the slot card with children, print host attrs + innerHTML on two lines. */
const server = (children) => {
  const script = `
    import { renderToString } from '@verajs/ssr';
    import { wire } from '@verajs/core';
    const { slots } = await import('@verajs/renderer/slots');
    wire([slots]);
    const out = (await renderToString(new URL('./tests/fixtures/ssr/slot-card-ssr.js', 'file://' + process.cwd() + '/'), { children: ${JSON.stringify(children)} })).html;
    process.stdout.write(out);
  `;
  return execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
};

const dom = new JSDOM('<div id="root"></div>');
for (const k of ['document','Node','Element','HTMLElement','Comment','Text','DocumentFragment','MutationObserver','customElements','CSSStyleSheet'])
  globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(() => fn(0), 0);
const settle = () => new Promise((r) => dom.window.setTimeout(r, 0));

const { wire } = await load('core');
const { renderInto, renderer } = await load('renderer/hydrate');
const { slots, slotted } = await load('renderer/slots');
wire([renderer, slots]);
const html = (strings, ...values) => ({ strings, values });
// the SAME template the fixture renders
const card = () => html`<article><header><slot name="header"><em>fallback header</em></slot></header><main><slot>default fallback</slot></main></article>`;

/** Build the light host from server output: parse it, take the host element into #root. */
const hostFromServer = (serverHtml) => {
  const wrap = dom.window.document.createElement('div');
  wrap.innerHTML = serverHtml;
  const host = wrap.firstElementChild; // <slot-card-ssr ...>
  dom.window.document.getElementById('root').appendChild(host);
  return host;
};

const test = (await import('node:test')).default;

test('named + default hydrate in place: server nodes survive, no <slot>, interactive', async () => {
  const serverHtml = server('<h2 slot="header">Hi there</h2>plain body<b>bold</b>');
  const host = hostFromServer(serverHtml);
  const h2Before = host.querySelector('h2');
  const bBefore = host.querySelector('b');
  renderInto(card(), host);
  await settle();
  assert.equal(host.querySelector('h2'), h2Before, 'the server h2 node SURVIVED adoption (identity)');
  assert.equal(host.querySelector('b'), bBefore, 'and the bold node');
  assert.equal(host.querySelector('header').textContent, 'Hi there');
  assert.equal(host.querySelector('main').textContent.replace(/\s/g,''), 'plainbodybold');
  assert.equal(host.querySelector('slot'), null, 'no <slot> element');
  assert.deepEqual(slotted(host, 'header').map((n) => n.textContent), ['Hi there'], 'capture map is live');
  assert.equal(slotted(host).length, 2, 'default: text + bold registered');
});

test('LIVE after hydration: removing an assigned node restores fallback', async () => {
  const serverHtml = server('<h2 slot="header">Hi</h2>');
  const host = hostFromServer(serverHtml);
  renderInto(card(), host);
  await settle();
  host.querySelector('h2').remove();
  await settle();
  assert.equal(host.querySelector('header').textContent, 'fallback header', 'fallback returned live post-hydration');
});

test('fallback-only hydrates: both slots show their (server-rendered) fallback', async () => {
  const serverHtml = server('');
  const host = hostFromServer(serverHtml);
  renderInto(card(), host);
  await settle();
  assert.equal(host.querySelector('header').textContent, 'fallback header');
  assert.equal(host.querySelector('main').textContent, 'default fallback');
  assert.equal(host.querySelector('slot'), null);
});

test('re-render after hydration keeps user nodes in place', async () => {
  const serverHtml = server('<input slot="header" />');
  const host = hostFromServer(serverHtml);
  renderInto(card(), host);
  await settle();
  const input = host.querySelector('input');
  input.value = 'typed';
  renderInto(card(), host); // re-render
  assert.equal(host.querySelector('input'), input, 'same node after re-render');
  assert.equal(input.value, 'typed', 'state intact');
});
