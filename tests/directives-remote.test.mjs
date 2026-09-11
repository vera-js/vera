/**
 * The remote pack — `data-vd-fetch` — against a REAL http server, because every claim here is
 * about what happens over a wire: content type deciding the outcome, origin deciding what a
 * response is allowed to be, and a later request beating an earlier one.
 *
 * The headline is the last test: markup that arrived over the network is LIVE — its handlers work
 * on the first click with no hydration step, because directives are matched by attribute at
 * dispatch and the engine's churn activation adopts whatever lands. That property is what makes
 * this pack 1.5 KB instead of a framework.
 *
 * Two origins, one server: jsdom is pointed at `127.0.0.1` and the same port answers on
 * `localhost`, which is a genuinely different origin to a browser. That is what lets the
 * cross-origin rules be tested for real rather than asserted about a mock.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

/* ── a real server ───────────────────────────────────────────────────────────────────────── */

let slowFirst = true;
let raceHits = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, type, body, delay = 0) =>
    setTimeout(() => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    }, delay);

  if (url.pathname === '/state') return send(200, 'application/json', JSON.stringify({ total: 120, label: 'from the server' }));
  if (url.pathname === '/state-reserved') return send(200, 'application/json', JSON.stringify({ _vdSneaky: 'no', ok: 'yes' }));
  if (url.pathname === '/markup')
    return send(200, 'text/html',
      `<button id="arrived" data-vd-on-click="{ clicks: clicks + 1 }">arrived over the network</button>`);
  if (url.pathname === '/boom') return send(500, 'text/plain', 'no');
  /**
   * Ordering, keyed on what the SERVER received rather than on what the client tried: the first
   * request to ARRIVE is answered slowly with a stale value, the second quickly with a fresh one.
   * A naive client lets the slow answer land last and win.
   */
  if (url.pathname === '/race') {
    raceHits++;
    const wasFirst = slowFirst;
    slowFirst = false;
    return send(200, 'application/json', JSON.stringify({ winner: wasFirst ? 'stale' : 'fresh' }), wasFirst ? 150 : 5);
  }
  send(404, 'text/plain', 'nope');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const ORIGIN = `http://127.0.0.1:${port}`;
/** The same server, a different ORIGIN — what a browser considers cross-origin. */
const FOREIGN = `http://localhost:${port}`;

/* ── the page ────────────────────────────────────────────────────────────────────────────── */

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: `${ORIGIN}/` });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet', 'location']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, interactions, expressions, remote, settled, rejections, stateOf } =
  await load('directives');
/** The foreign origin is ALLOWLISTED — which is what makes the markup refusal meaningful: it is
 *  refused for being markup from elsewhere, not for being from an unknown origin. */
wireDirectives([expressions, ...interactions, remote({ allowedOrigins: [FOREIGN] })]);

const doc = dom.window.document;
const until = async (probe, what, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    await settled();
    const value = probe();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for: ${what}`);
};
const mount = async (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  await settled();
  return host;
};

test.after(() => server.close());

test('a JSON response is a STATE PATCH — every reflection updates itself, nothing renders it', async () => {
  const host = await mount(`
    <div data-vd-state="{ total: 0, label: 'before', phase: 'idle' }">
      <button data-vd-fetch="{ url: '${ORIGIN}/state', on: 'click', status: 'phase' }">load</button>
      <b data-vd-text="total"></b><i data-vd-text="label"></i>
      <u data-vd-text="phase"></u>
    </div>`);
  assert.equal(host.querySelector('b').textContent, '0', 'the control: it started at the seed');
  host.querySelector('button').click();
  await until(() => host.querySelector('b').textContent === '120', 'the patched number reached the DOM');
  assert.equal(host.querySelector('i').textContent, 'from the server', 'and every key in the patch');
  assert.equal(host.querySelector('u').textContent, 'idle', 'the status key settled back to idle');
  host.remove();
  await settled();
});

test('animate: true — a user-triggered swap rides the flip door; on: load is establishment', async () => {
  let transitions = 0;
  doc.startViewTransition = (callback) => {
    transitions++;
    callback();
    return { finished: Promise.resolve() };
  };
  /** on: 'load' — initial content answers no one, so establishment never animates. */
  const first = await mount(`
    <div data-vd-state="{}">
      <div id="zoneA" data-vd-fetch="{ url: '${ORIGIN}/markup', on: 'load', into: '#zoneA', animate: true }"></div>
    </div>`);
  await until(() => first.querySelector('#arrived'), 'the load-triggered swap landed');
  assert.equal(transitions, 0, 'on: load is establishment — the door refuses, the swap is instant');
  first.remove();
  await settled();

  const host = await mount(`
    <div data-vd-state="{}">
      <button id="go" data-vd-fetch="{ url: '${ORIGIN}/markup', on: 'click', into: '#zone', animate: true }">go</button>
      <div id="zone"><p>old content — its exit is the crossfade</p></div>
    </div>`);
  host.querySelector('#go').click();
  await until(() => host.querySelector('#arrived'), 'the clicked swap landed');
  assert.equal(transitions, 1, 'a user-triggered swap is a response: one transition, old-to-new');
  assert.equal(doc.querySelectorAll('[style*="view-transition-name"]').length, 0,
    'the transient name cleared after finished');

  delete doc.startViewTransition;
  host.remove();
  await settled();
});

test('the engine\'s reserved prefix is not writable by a server', async () => {
  const host = await mount(`
    <div data-vd-state="{ ok: 'no' }">
      <button data-vd-fetch="{ url: '${ORIGIN}/state-reserved', on: 'click' }">go</button>
    </div>`);
  host.querySelector('button').click();
  const carrier = host.querySelector('[data-vd-state]');
  await until(() => stateOf(carrier).ok === 'yes', 'the ordinary key landed');
  assert.equal(stateOf(carrier)._vdSneaky, undefined, 'and the _vd-prefixed one was dropped');
  host.remove();
  await settled();
});

test('a failing response is a refusal and a status, never a broken page', async () => {
  const host = await mount(`
    <div data-vd-state="{ phase: 'idle' }">
      <button data-vd-fetch="{ url: '${ORIGIN}/boom', on: 'click', status: 'phase' }">go</button>
      <u data-vd-text="phase"></u>
    </div>`);
  host.querySelector('button').click();
  await until(() => host.querySelector('u').textContent === 'error', 'the status key reports the failure');
  assert.ok(rejections(host.querySelector('button')).some((r) => r.code === 'fetch-failed'), 'and the registry has the sentence');
  host.remove();
  await settled();
});

test('a URL this page may not request is refused before any request exists', async () => {
  const host = await mount(`
    <div data-vd-state="{ n: 0 }">
      <button id="js" data-vd-fetch="{ url: 'javascript:alert(1)', on: 'click' }">a</button>
      <button id="off" data-vd-fetch="{ url: 'https://evil.test/x', on: 'click' }">b</button>
    </div>`);
  for (const id of ['js', 'off']) {
    assert.ok(rejections(host.querySelector('#' + id)).some((r) => r.code === 'fetch-url-refused'),
      `${id}: refused at activation, not at click`);
  }
  host.remove();
  await settled();
});

test('an ALLOWLISTED origin may send data and never a document', async () => {
  const host = await mount(`
    <div data-vd-state="{ n: 0 }">
      <button data-vd-fetch="{ url: '${FOREIGN}/markup', on: 'click', into: 'self' }">go</button>
    </div>`);
  const button = host.querySelector('button');
  button.click();
  await until(() => rejections(button).some((r) => r.code === 'fetch-foreign-markup'),
    'markup from another origin is refused even though the origin is allowed');
  assert.doesNotMatch(button.innerHTML, /arrived over the network/, 'and nothing was swapped in');
  host.remove();
  await settled();
});

test('two clicks in one tick make exactly ONE request — the first never reaches the wire', async () => {
  const host = await mount(`
    <div data-vd-state="{ winner: 'none' }">
      <button data-vd-fetch="{ url: '${ORIGIN}/race', on: 'click' }">go</button>
      <b data-vd-text="winner"></b>
    </div>`);
  const before = raceHits;
  const button = host.querySelector('button');
  button.click();
  button.click();
  await until(() => host.querySelector('b').textContent !== 'none', 'an answer landed');
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(raceHits - before, 1,
    'the abort beat the dispatch: the superseded request was never sent at all');
  host.remove();
  await settled();
});

test('and when both DO reach the server, the stale answer can never win', async () => {
  const host = await mount(`
    <div data-vd-state="{ winner: 'none' }">
      <button data-vd-fetch="{ url: '${ORIGIN}/race', on: 'click' }">go</button>
      <b data-vd-text="winner"></b>
    </div>`);
  const before = raceHits;
  const button = host.querySelector('button');
  button.click();
  /** Far enough apart that the first request is genuinely in flight — a user typing. */
  await new Promise((r) => setTimeout(r, 30));
  button.click();
  await until(() => host.querySelector('b').textContent === 'fresh', 'the second answer landed');
  assert.equal(raceHits - before, 2, 'the control: both requests really did reach the server');
  /** The slow first response arrives ~150 ms later; it must never overwrite. */
  await new Promise((r) => setTimeout(r, 300));
  await settled();
  assert.equal(host.querySelector('b').textContent, 'fresh', 'and the stale one is discarded on arrival');
  host.remove();
  await settled();
});

test('THE HEADLINE: markup from the network is live on its first click — no hydration step', async () => {
  const host = await mount(`
    <div data-vd-state="{ clicks: 0 }">
      <button id="load" data-vd-fetch="{ url: '${ORIGIN}/markup', on: 'click', into: '#zone' }">load</button>
      <div id="zone"></div>
      <b data-vd-text="clicks"></b>
    </div>`);
  host.querySelector('#load').click();
  const arrived = await until(() => host.querySelector('#arrived'), 'the fragment was swapped in');

  /**
   * Nothing activated it, nothing hydrated it, and nothing was told it exists — the handler is in
   * the attribute and one delegated listener was already matching by name.
   */
  arrived.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
  await until(() => host.querySelector('b').textContent === '1',
    'a button that did not exist when the page loaded wrote the page\'s state');
  host.remove();
  await settled();
});
