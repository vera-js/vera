/**
 * **Server markup on a client that does not hydrate** (2026-10-08, Brian's choice of five). A first render APPENDS beside
 * a container's existing children, so server markup with no hydration wired is shown twice — the server's copy dead.
 * Unmarked markup cannot be recognized (the documented rule: server-rendered HTML must be hydrated — pinned below as the
 * contract). A server with slots wired states every host it renders (`data-vm-light`), which is the case that CAN be
 * told, and slots acts on it before the render would append (the renderer's `_$unadopted$`):
 * - stated EMPTY (`N:`) — nothing of the page's in it: the server's render is cleared (its SSR stylesheet kept), the
 *   client renders once, the statement consumed;
 * - stated WITH light content — which cannot be told from the server's render without `hydrateSlots`: the host stands
 *   exactly as served, and the coded error (`hydration-unwired`) names what to wire.
 * Development warns once per page, not per host.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const serve = (fixture, children) =>
  execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
    import { renderToString } from '@verajs/ssr'; import { wire } from '@verajs/core';
    const { slots } = await import('@verajs/renderer/slots'); wire([slots]);
    process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/${fixture}.js', 'file://' + process.cwd() + '/'), { children: ${JSON.stringify(children)} })).html);
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];
const { wire, html } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots } = await load('renderer/slots');
/** Slots, and NO hydration — the misconfiguration under test. */
wire([renderer, slots]);
const doc = dom.window.document;
const said = [];
const original = console.warn;
console.warn = (...args) => said.push(args.join(' '));
const mount = (markup) => {
  const holder = doc.createElement('div');
  holder.innerHTML = markup;
  doc.body.append(holder);
  return holder.firstElementChild;
};
const card = () => html`<article><header><slot name="header"><em>fh</em></slot></header><main><slot>df</slot></main></article>`;
const plain = () => html`<section><h1>Plain</h1><input value="server"><button>go</button></section>`;

test('a served host holding the page\'s light content stands exactly as served, and the coded error names what to wire', () => {
  const served = serve('slot-card-ssr', '<h2 slot="header">H</h2>body');
  assert.match(served, /data-vm-light="1:0,1"/, 'CONTROL: stated WITH light content');
  const host = mount(served);
  const before = host.outerHTML;
  assert.throws(() => renderInto(card(), host), /hydration-unwired/);
  assert.equal(host.outerHTML, before, 'not one node touched — the user\'s content is all still there');
});

test('a served host stated EMPTY is cleared and rendered once: no duplicate, the statement consumed', () => {
  const host = mount(serve('slot-free-ssr', ''));
  assert.equal(host.getAttribute('data-vm-light'), '1:', 'CONTROL: stated empty');
  const server = host.querySelector('section');
  renderInto(plain(), host);
  assert.equal(host.querySelectorAll('section').length, 1, 'one copy, not two');
  assert.notEqual(host.querySelector('section'), server, 'the client\'s own — the server\'s copy is gone');
  assert.equal(host.hasAttribute('data-vm-light'), false, 'the statement consumed');
});

/**
 * **An empty statement can never hold the page's content**, so the clear above can never drop it. The number before the
 * colon is the statement's FORMAT, not a count; the runs after it place every light child, and the unassigned carrier is
 * a range like any slot's. A host whose only light content no slot took is stated WITH a run — and stands, untouched.
 * (Asked by the audit: does "stated empty" clear content that waits in the carrier? It cannot reach the clear at all.)
 */
test('light content no slot took is stated as a run, so an unwired client leaves it standing', () => {
  const served = serve('slot-free-ssr', '<b slot="later">L</b>');
  assert.match(served, /data-vm-light="1:0"/, 'CONTROL: the carrier is a range — stated with a run, not empty');
  assert.match(served, /<ins hidden="" data-vm-unassigned="">\s*<b slot="later">L<\/b>/, 'and the content waits in it');
  const host = mount(served);
  const before = host.outerHTML;
  assert.throws(() => renderInto(plain(), host), /hydration-unwired/);
  assert.equal(host.outerHTML, before, 'nothing cleared: the unassigned content is still the host\'s');
});

test('the clear keeps the host\'s SSR stylesheet, as a hydration fallback does', () => {
  const host = mount('<slot-free-ssr data-vm-light="1:"><style data-vm-sheet="styles">p{}</style><section>server</section></slot-free-ssr>');
  const sheet = host.querySelector('style');
  renderInto(plain(), host);
  assert.equal(host.querySelector('style'), sheet, 'the stylesheet stands');
  assert.equal(host.querySelectorAll('section').length, 1);
});

test('development warns ONCE per page, however many hosts it re-rendered', { skip: isProduction && 'the warning is development-only' }, () => {
  const ours = said.filter((line) => line.includes('hydration-unwired'));
  assert.equal(ours.length, 1, `one warning for every host above: ${ours.join(' | ')}`);
  assert.match(ours[0], /wire\(\[renderer, hydration\]\)/, 'and it names the fix');
});

test('production prints nothing for the empty case', { skip: !isProduction && 'production only' }, () => {
  assert.deepEqual(said.filter((line) => line.includes('hydration-unwired')), []);
});

/**
 * **The documented contract for UNMARKED server markup**: nothing can recognize it, so a client that does not hydrate
 * renders beside it — two copies. Pinned so that changing it is a decision; the docs' rule is the remedy.
 */
test('CONTRACT: an unmarked container of server markup, with nothing hydrating, gets a second render beside it', () => {
  const container = doc.createElement('div');
  container.innerHTML = '<p>Hello</p>';
  doc.body.append(container);
  renderInto(html`<p>${'Hello'}</p>`, container);
  assert.equal(container.querySelectorAll('p').length, 2, 'the server\'s and the client\'s — wire hydration to adopt instead');
});

test.after(() => {
  console.warn = original;
});
