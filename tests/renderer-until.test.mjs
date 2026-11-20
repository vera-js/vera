/**
 * **`until(promise, fallback)`** (`@verajs/renderer/until`, 2026-10-26): a promise at a child position. The fallback,
 * then the value; the same promise again keeps what is shown; a new one drops the old one's late answer; removal before
 * it settles drops the answer; a value that is not a promise is shown at once; a rejection keeps the fallback and is
 * reported; a server renders the fallback without waiting; hydration draws it again and the value replaces it. Counts
 * are exact, each with a control that the counted thing ran.
 */
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { distUrl, isProduction, load } from './dist.mjs';

/** The server half (`tests/fixtures/ssr/until-ssr.js`), through the real pipeline, timed. */
const served = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr';
  const t0 = performance.now();
  const r = await renderToString(new URL('./tests/fixtures/ssr/until-ssr.js', process.getBuiltinModule('node:url').pathToFileURL(process.cwd() + '/')), { tag: 'until-ssr' });
  await new Promise((r) => setTimeout(r, 50));
  process.stdout.write(JSON.stringify({ html: r.html, ms: performance.now() - t0 }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 20000 });

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, flush } = await load('core');
const { renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
const { until } = await load('renderer/until');
wire([renderer, hydration]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { flush(); await wait(0); flush(); };
let seq = 0;
const tag = () => `x-until-${++seq}`;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const mount = async (t) => { const el = document.createElement(t); document.body.append(el); await settle(); return el; };

test('the fallback, then the value', async () => {
  const d = deferred();
  const t = tag();
  define(t, () => () => html`<p>${until(d.promise, html`<em>loading</em>`)}</p>`);
  const el = await mount(t);
  assert.equal(el.textContent, 'loading', 'the fallback while it waits');
  d.resolve('Ada');
  await settle();
  assert.equal(el.textContent, 'Ada');
  el.remove();
});

test('the SAME promise on a re-render keeps what is shown — no flash back to the fallback', async () => {
  const d = deferred();
  const s = createStore({ n: 1 });
  const t = tag();
  define(t, () => () => html`<p>${s.n}:${until(d.promise, 'loading')}</p>`);
  const el = await mount(t);
  d.resolve('Ada');
  await settle();
  assert.equal(el.textContent, '1:Ada', 'CONTROL: resolved');
  s.n = 2;
  await settle();
  assert.equal(el.textContent, '2:Ada', 're-rendered with the same promise: the value, not the fallback');
  el.remove();
});

test("a NEW promise shows the fallback again, and the OLD one's late answer is dropped", async () => {
  const first = deferred(), second = deferred();
  const s = createStore({ p: first.promise });
  const t = tag();
  define(t, () => () => html`<p>${until(s.p, 'loading')}</p>`);
  const el = await mount(t);
  s.p = second.promise;
  await settle();
  assert.equal(el.textContent, 'loading', 'the new one waits');
  second.resolve('new');
  await settle();
  first.resolve('OLD');
  await settle();
  assert.equal(el.textContent, 'new', 'the slow old answer never overwrites the newer one');
  el.remove();
});

test('REMOVED before it settles: the answer is dropped — nothing commits, nothing throws', async () => {
  const d = deferred();
  const s = createStore({ show: true });
  const t = tag();
  define(t, () => () => html`<div>${s.show ? html`<p>${until(d.promise, 'loading')}</p>` : ''}</div>`);
  const el = await mount(t);
  assert.equal(el.textContent, 'loading', 'CONTROL: waiting');
  s.show = false;
  await settle();
  const logged = [];
  const original = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try { d.resolve('late'); await settle(); } finally { console.error = original; }
  assert.deepEqual([el.textContent, logged.length], ['', 0], 'nothing drawn, nothing said');
  el.remove();
});

test('a value that is NOT a promise is shown at once — no fallback', async () => {
  const t = tag();
  define(t, () => () => html`<p>${until('ready', 'loading')}</p>`);
  const el = await mount(t);
  assert.equal(el.textContent, 'ready');
  el.remove();
});

/**
 * The rejection row runs in a CHILD process: `until` leaves it unhandled ON PURPOSE, and `node --test` fails whichever test
 * an unhandled rejection lands in. The child loads the same build and listens as the platform's report would be heard.
 */
const rejected = JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--input-type=module', '-e', `
  import { JSDOM } from 'jsdom';
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame']) globalThis[key] = dom.window[key];
  const { define, html, wire, flush } = await import(${JSON.stringify(distUrl('core'))});
  const { renderer } = await import(${JSON.stringify(distUrl('renderer'))});
  const { until } = await import(${JSON.stringify(distUrl('renderer/until'))});
  wire([renderer]);
  const unhandled = [], warned = [];
  process.on('unhandledRejection', (reason) => unhandled.push(String(reason?.message)));
  console.warn = (...a) => warned.push(a.join(' '));
  let reject;
  const promise = new Promise((_, b) => (reject = b));
  define('x-until-rej', () => () => html\`<p>\${until(promise, 'loading')}</p>\`);
  const el = document.createElement('x-until-rej');
  document.body.append(el);
  flush(); await new Promise((r) => setTimeout(r, 0)); flush();
  reject(new Error('boom'));
  await new Promise((r) => setTimeout(r, 20));
  process.stdout.write(JSON.stringify({ shown: el.textContent, unhandled, hinted: warned.some((w) => w.includes('until-rejected')) }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 20000 }));

test('a REJECTION keeps the fallback and is left to the PLATFORM (unhandled, so reported with its stack); development adds a hint', () => {
  assert.deepEqual([rejected.shown, rejected.unhandled], ['loading', ['boom']], 'the fallback kept; the platform heard the rejection, once');
  assert.equal(rejected.hinted, !isProduction, 'the hint in development only');
});

test('on a SERVER: the fallback is rendered, and a promise that never settles does not hold the request', () => {
  const { html: markup, ms } = JSON.parse(served);
  assert.match(markup, /<p><em>loading<\/em><\/p>/, 'the fallback, served');
  assert.match(markup, /<p><em>still serving<\/em><\/p>/, 'a REJECTING promise: served its fallback, and the process lived to say so');
  assert.ok(ms < 5000, `the server returned without waiting (${ms.toFixed(0)} ms)`);
});

test('HYDRATION: the served fallback is drawn again, and the value replaces it, with nothing said', async () => {
  const { html: markup } = JSON.parse(served);
  const root = document.createElement('div');
  document.body.append(root);
  root.innerHTML = markup.replaceAll('until-ssr', 'until-hy');
  const d = deferred();
  const warned = [];
  const original = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    define('until-hy', () => () => html`<p>${until(d.promise, html`<em>loading</em>`)}</p><p>${until(new Promise(() => {}), html`<em>still serving</em>`)}</p>`);
    await settle();
    const host = root.querySelector('until-hy');
    assert.equal(host.textContent, 'loadingstill serving', 'CONTROL: adopted and still waiting');
    d.resolve('Ada');
    await settle();
    assert.deepEqual([host.textContent, warned.filter((w) => w.includes('[vera]'))], ['Adastill serving', []]);
  } finally {
    console.warn = original;
    root.remove();
  }
});
