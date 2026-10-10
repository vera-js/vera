/**
 * **`renderer({ shadow })` — the app's default root, and the renderer declining on a server** (R1 piece 3; Brian's
 * (b′), 2026-10-10). Precedence: a component's own `shadow` (an explicit `false` included) → the renderer's default →
 * light DOM. On a server (`@verajs/ssr` loaded) the renderer declines its render insert and keeps only the default, so
 * ONE shared `wire([renderer({ shadow })])` carries the same root to both sides. The server rows run in a child process,
 * so this process never becomes a server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame', 'ShadowRoot'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const core = await load('core');
const { renderer } = await load('renderer');
const { init, html, wire, inserts } = core;
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;
const listen = async (run) => {
  const said = [];
  const saved = { warn: console.warn, error: console.error };
  console.warn = (...a) => said.push(`warn ${a.join(' ')}`);
  console.error = (...a) => said.push(`error ${a.join(' ')}`);
  try { await run(); } finally { Object.assign(console, saved); }
  return said;
};
/** A one-form component and a legacy one, each given the options `own` (or none). */
const mount = async (connect) => {
  const tag = `x-default-${seq++}`;
  customElements.define(tag, class extends HTMLElement { connectedCallback() { connect(this); } });
  const el = doc.createElement(tag);
  doc.body.append(el);
  await tick();
  return el;
};
/** The default lives on core's registry; each row starts from none. */
const reset = () => { delete inserts.$S; };

test('bare wire([renderer]) renders, and a component that says nothing is light DOM', async () => {
  reset();
  wire([renderer]);
  const el = await mount((host) => init(host, () => () => html`<p>light</p>`));
  assert.ok(el.shadowRoot === null && el.textContent === 'light');
});

test("renderer({ shadow: 'open' }) gives every component that says nothing an open root — one-form and legacy", async () => {
  reset();
  wire([renderer({ shadow: 'open' })]);
  const form = await mount((host) => init(host, () => () => html`<p>f</p>`));
  assert.ok(form.shadowRoot?.textContent === 'f', 'the one form');
  const legacy = await mount((host) => { init(host); core.render(() => html`<p>l</p>`); });
  assert.ok(legacy.shadowRoot?.textContent === 'l', 'the legacy init(this) too');
  reset();
  wire([renderer]);
});

test("a component's own shadow beats the default — false for light, 'closed', and a legacy shadowProps", async () => {
  reset();
  wire([renderer({ shadow: 'open' })]);
  const light = await mount((host) => init({ host, shadow: false }, () => () => html`<p>l</p>`));
  assert.ok(light.shadowRoot === null && light.textContent === 'l', 'false is explicitly light');
  const closed = await mount((host) => init({ host, shadow: 'closed' }, () => () => html`<p>c</p>`));
  assert.ok(closed.shadowRoot === null && closed.textContent === '', 'closed: hidden, the light DOM untouched');
  const legacy = await mount((host) => { init(host, { mode: 'closed' }); core.render(() => html`<p>x</p>`); });
  assert.ok(legacy.shadowRoot === null && legacy.textContent === '', 'the explicit legacy shadowProps wins');
  reset();
  wire([renderer]);
});

test('an invalid default is named once, and components fall back to light DOM', async () => {
  reset();
  const said = await listen(async () => {
    wire([renderer({ shadow: true })]);
    const one = await mount((host) => init(host, () => () => html`<p>a</p>`));
    const two = await mount((host) => init(host, () => () => html`<p>b</p>`));
    assert.ok(one.shadowRoot === null && two.shadowRoot === null, 'light DOM');
  });
  if (!isProduction) assert.equal(said.filter((line) => line.includes('shadow-option')).length, 1, `once: ${said.join(' | ')}`);
  reset();
  wire([renderer]);
});

test('the dual stays a real function: call, bind and instanceof Function, bare and called', () => {
  assert.ok(typeof renderer.call === 'function' && typeof renderer.bind === 'function', 'bare');
  assert.ok(renderer instanceof Function && renderer({ shadow: 'open' }) instanceof Function, 'and called');
});

test("renderer('open') — a slip for { shadow: 'open' } — is named ONCE, not once per character, and sets no default", async () => {
  reset();
  let module;
  const said = await listen(async () => { module = renderer('open'); wire([module]); });
  assert.equal(inserts.$S, undefined, 'no default set');
  if (!isProduction) {
    assert.equal(said.filter((line) => line.includes('renderer-options')).length, 1, said.join(' | '));
    assert.equal(said.filter((line) => line.includes('unknown-option')).length, 0, 'no per-character noise');
  }
  reset();
  wire([renderer]);
});

test('an unknown renderer() key is named by the shared unknown-option', async () => {
  const said = await listen(async () => { renderer({ shadwo: 'open' }); });
  if (!isProduction) assert.ok(said.some((line) => line.includes('unknown-option') && line.includes('shadwo')), said.join(' | '));
});

/** A server process: imports ssr FIRST (or not), then the shared app wiring, then renders. */
const server = (script) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', script], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
}));

test('on a server, the shared wire([renderer({ shadow })]) declines its render insert, keeps the default, and says so once', () => {
  const out = server(`
    const said = [];
    console.warn = (...a) => said.push(a.join(' '));
    const { renderToString } = await import('@verajs/ssr');
    const { wire, init, html } = await import('@verajs/core');
    const { renderer } = await import('@verajs/renderer');
    wire([renderer({ shadow: 'open' })]);
    wire([renderer]);
    const { html: page } = await renderToString(new URL('./tests/fixtures/ssr/default-shadow-ssr.js', 'file://' + process.cwd() + '/'), { tag: 'sd-card' });
    process.stdout.write(JSON.stringify({ page, declines: said.filter((l) => l.includes('renderer-on-server')).length }));
  `);
  assert.match(out.page, /<sd-card><template shadowrootmode="open"><p>served<\/p><\/template><\/sd-card>/, `the default reached the server: ${out.page}`);
  /** The render SUCCEEDED, so the server's own renderer was still in place: the shared wire call did not displace it. */
  if (!isProduction) assert.equal(out.declines, 1, 'said once per process, for two wire calls');
});

/**
 * The order is forced on a real server: the renderer reads `document` as it loads, so it cannot even be imported before
 * `@verajs/ssr` installs the DOM. What can still displace the server's renderer is a render insert that is NOT vera's
 * renderer — refused at render time, naming the fix.
 */
test("a render insert that is not vera's renderer still displaces the server's — and the refusal names the fix", () => {
  const out = server(`
    const { renderToString } = await import('@verajs/ssr');
    const { wire } = await import('@verajs/core');
    wire({ on: 'render', fn: () => {}, priority: 50 });
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'vera-default-'));
    writeFileSync(join(dir, 'c.js'), "customElements.define('sd-late', class extends HTMLElement {});");
    let message = '';
    try { await renderToString(new URL('file://' + join(dir, 'c.js')), { tag: 'sd-late' }); } catch (error) { message = error.message; }
    process.stdout.write(JSON.stringify({ message }));
  `);
  assert.match(out.message, /ssr-renderer-replaced/, `refused: ${out.message}`);
  if (!isProduction) assert.match(out.message, /Import @verajs\/ssr BEFORE wiring the renderer/, 'and names the fix');
});
