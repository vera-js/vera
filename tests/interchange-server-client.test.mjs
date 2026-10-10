/**
 * **Server and client code are interchangeable** (Brian, 2026-10-10: "component and build code should work identically
 * on the server and client, they should be interchangeable"). ONE shared app module — tests/fixtures/interchange/app.js:
 * every client module wired (renderer, hydration, slots, hydrateSlots, styles), real components, NO server guard — is
 * rendered by @verajs/ssr in a server process and hydrated in this one. The server must render it without a throw or a
 * stray line; the client must ADOPT what was served — identity kept, no fallback — and then be live.
 *
 * NOT covered here (the claim is exactly this wide): shadow DOM and `renderer({ shadow })` as the default (jsdom's
 * innerHTML does not parse declarative shadow DOM — the browser suite's row, owed after the heat hold); the router's
 * navigation half; `@verajs/directives`, `@verajs/motion`, `@verajs/cms`, `@verajs/ui` (out of scope until after the
 * release); `@scope` in a real engine (jsdom has none, so its one `no-scope` warning is the one engine line allowed here).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import { isProduction } from './dist.mjs';

const root = new URL('..', import.meta.url);
/** The child runs THIS build: a bare `@verajs/*` import resolves by conditions, so they are passed explicitly. */
const conditions = isProduction ? [] : ['--conditions', 'development'];
const server = JSON.parse(execFileSync(process.execPath, [...conditions, '--input-type=module', '-e', `
  const said = [];
  for (const level of ['warn', 'error']) console[level] = (...a) => said.push(level + ' ' + a.join(' '));
  const { renderToString } = await import('@verajs/ssr');
  const out = await renderToString(new URL('./tests/fixtures/interchange/app.js', 'file://' + process.cwd() + '/'), { tag: 'ia-app' });
  process.stdout.write(JSON.stringify({ html: out.html, styles: out.styles, said, core: import.meta.resolve('@verajs/core') }));
`], { cwd: root, encoding: 'utf8', env: { ...process.env } }));
const build = (path) => (path.endsWith('.min.js') ? 'production' : path.includes('/development/') ? 'development' : `unknown: ${path}`);

test('CONTROL: the server ran this build', () => {
  assert.equal(build(server.core), isProduction ? 'production' : 'development', server.core);
});

test('the server renders the shared module — its content in place, its effect run, its styles — and says exactly the decline', () => {
  const page = server.html;
  assert.match(page, /<ia-counter[^>]*data-effects="1"[^>]*>[\s\S]*<p>count 1<\/p><button>more<\/button>/, `the counter, its effect run once on the server: ${page.slice(0, 400)}`);
  assert.match(page, /<header>[\s\S]*<h2 slot="header">Title<\/h2>[\s\S]*<\/header><main>[\s\S]*body[\s\S]*<\/main>/, 'the named slot in the header, the unnamed content in main');
  assert.match(page, /<ia-styled[^>]*><p>styled<\/p><\/ia-styled>/, 'the styled component');
  assert.match(server.styles, /rebeccapurple/, 'its styles reached the page styles');
  assert.deepEqual(server.said.filter((line) => !line.includes('renderer-on-server')), [], 'nothing but the decline');
  assert.equal(server.said.length, isProduction ? 0 : 1, 'the decline once in development, nothing in production');
});

test('the client imports the SAME module and adopts what the server rendered — then it is live', async () => {
  /** jsdom's own CSS parser cannot read `@scope` — its message, not ours, so it goes to its own console. */
  const jsdomSaid = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => jsdomSaid.push(error.message));
  const dom = new JSDOM(`<!doctype html><head><style>${server.styles}</style></head><body>${server.html}</body>`, { pretendToBeVisual: true, virtualConsole });
  for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text', 'DocumentFragment', 'MutationObserver', 'customElements', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'ShadowRoot'])
    globalThis[k] = dom.window[k];
  assert.equal(build(import.meta.resolve('@verajs/core')), isProduction ? 'production' : 'development', 'CONTROL: the client runs this build');
  const doc = dom.window.document;
  const before = { p: doc.querySelector('ia-counter p'), button: doc.querySelector('ia-counter button'), h2: doc.querySelector('ia-card h2'), styled: doc.querySelector('ia-styled p') };
  assert.ok(Object.values(before).every(Boolean), 'CONTROL: the served markup is in the page');
  const said = [];
  const saved = { warn: console.warn, error: console.error };
  console.warn = (...a) => said.push(`warn ${a.join(' ')}`);
  console.error = (...a) => said.push(`error ${a.join(' ')}`);
  try {
    await import('./fixtures/interchange/app.js');
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    Object.assign(console, saved);
  }
  /** The one engine line allowed: jsdom has no `@scope` (a real engine does — the browser row asserts silence). */
  assert.deepEqual(said.filter((line) => !line.includes('(no-scope)')), [], 'no hydration fallback, nothing else said');
  assert.ok(said.length <= 1, `at most the one no-scope line: ${said.join(' | ')}`);
  assert.ok(doc.querySelector('ia-counter p') === before.p && doc.querySelector('ia-counter button') === before.button, 'the counter was adopted');
  assert.ok(doc.querySelector('ia-card h2') === before.h2, 'the slotted header was adopted');
  assert.ok(doc.querySelector('ia-styled p') === before.styled, 'the styled component was adopted');
  assert.equal(doc.querySelector('ia-counter').dataset.effects, '2', 'its effect ran on the client too (the server ran it once)');
  doc.querySelector('ia-counter button').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(doc.querySelector('ia-counter p') === before.p, 'updated IN PLACE');
  assert.equal(before.p.textContent, 'count 2', 'and live');
});
