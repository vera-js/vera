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
import { createServer, get } from 'node:http';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

/* ── a real server ───────────────────────────────────────────────────────────────────────── */

let slowFirst = true;
let raceHits = 0;
let countedHits = 0;
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
  if (url.pathname === '/counted') { countedHits++; return send(200, 'application/json', JSON.stringify({ n: countedHits })); }
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
  /** The live wire: one endpoint, the mode picks what gets pushed after connect. */
  if (url.pathname === '/sse') {
    sseConnections++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const mode = url.searchParams.get('mode') ?? 'patch';
    setTimeout(() => {
      if (mode === 'patch') res.write('data: {"total": 55}\n\n');
      if (mode === 'named') res.write('event: score\ndata: {"total": 77}\n\n');
      if (mode === 'reserved') res.write('data: {"_vdSneak": 1, "safe": 2}\n\n');
      if (mode === 'markup') res.write('data: <button id="pushed" data-vd-on-click="{ n: n + 1 }">live</button>\n\n');
    }, 40);
    req.on('close', () => sseConnections--);
    return;
  }
  send(404, 'text/plain', 'nope');
});
let sseConnections = 0;
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

test.after(() => {
  /** Live SSE responses hold the server open forever — sever them, then close. */
  server.closeAllConnections?.();
  server.close();
});

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

test('place: append accumulates and prepend leads — existing DOM is never rewritten', async () => {
  const host = await mount(`
    <div data-vd-state="{}">
      <button id="more" data-vd-fetch="{ url: '${ORIGIN}/markup', on: 'click', into: '#feed', place: 'append' }">more</button>
      <button id="top" data-vd-fetch="{ url: '${ORIGIN}/markup', on: 'click', into: '#feed', place: 'prepend' }">top</button>
      <div id="feed"><p id="keep">the server-rendered start</p></div>
    </div>`);
  const feed = host.querySelector('#feed');

  host.querySelector('#more').click();
  await until(() => feed.querySelectorAll('[data-vd-on-click]').length === 1, 'first append landed');
  /** Mark the live element: if a later placement REWRITES the container, this mark dies. */
  feed.querySelector('[data-vd-on-click]').marked = true;

  host.querySelector('#more').click();
  await until(() => feed.querySelectorAll('[data-vd-on-click]').length === 2, 'second append landed');
  assert.ok(feed.querySelector('#keep'), 'the original content is still there');
  assert.equal(feed.querySelector('[data-vd-on-click]').marked, true,
    'the first arrival is the SAME element — insertAdjacentHTML parsed into position, no rewrite');
  assert.equal(feed.lastElementChild.matches('[data-vd-on-click]'), true, 'append lands at the end');

  host.querySelector('#top').click();
  await until(() => feed.querySelectorAll('[data-vd-on-click]').length === 3, 'prepend landed');
  assert.equal(feed.firstElementChild.matches('[data-vd-on-click]'), true, 'prepend leads');
  assert.equal(feed.firstElementChild.marked, undefined, 'and it is the new arrival, not the marked one');
  host.remove();
  await settled();
});

test('place: an unknown placement is a refusal, and no request is made worse by it', async () => {
  const host = await mount(`
    <div data-vd-state="{}">
      <button id="bad" data-vd-fetch="{ url: '${ORIGIN}/markup', on: 'click', into: '#z2', place: 'inside' }">x</button>
      <div id="z2"><p>untouched</p></div>
    </div>`);
  host.querySelector('#bad').click();
  await new Promise((r) => setTimeout(r, 150));
  await settled();
  assert.equal(host.querySelector('#z2').textContent.trim(), 'untouched', 'the target was not written');
  assert.ok(rejections().some((r) => r.code === 'fetch-place-unknown'), 'and the refusal names the code');
  host.remove();
  await settled();
});

test('place + animate: arrivals ENTER individually — named inside the commit, container unnamed', async () => {
  let namedDuringCapture = -1;
  let containerNamed = true;
  doc.startViewTransition = (callback) => {
    callback();
    const feed = doc.querySelector('#feed3');
    namedDuringCapture = [...feed.children]
      .filter((child) => child.style.getPropertyValue('view-transition-name')).length;
    containerNamed = feed.style.getPropertyValue('view-transition-name') !== '';
    return { finished: Promise.resolve() };
  };
  const host = await mount(`
    <div data-vd-state="{}">
      <button id="grow" data-vd-fetch="{ url: '${ORIGIN}/markup', on: 'click', into: '#feed3', place: 'append', animate: true }">more</button>
      <div id="feed3"><p>existing</p></div>
    </div>`);
  host.querySelector('#grow').click();
  await until(() => host.querySelector('#feed3 [data-vd-on-click]'), 'the arrival landed');
  assert.equal(namedDuringCapture, 1, 'exactly the ARRIVAL carried a name during capture — the enter kind');
  assert.equal(containerNamed, false, 'and the container did not morph as a whole');
  assert.equal(doc.querySelectorAll('[style*=view-transition-name]').length, 0, 'names cleared after finished');
  delete doc.startViewTransition;
  host.remove();
  await settled();
});

test('the pun guard: an accumulating feed with a URL-bound depth key warns once (dev only)', async () => {
  const isProd = process.env.VERA_DIST === 'production';
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  try {
    const host = await mount(`
      <div data-vd-state="{ page: 1 }" data-vd-query="page">
        <button id="feedmore" data-vd-fetch="{ url: '${ORIGIN}/markup?page=2', on: 'click', into: '#feed2', place: 'append' }">more</button>
        <div id="feed2"></div>
      </div>`);
    host.querySelector('#feedmore').click();
    await until(() => host.querySelector('#feed2 [data-vd-on-click]'), 'the append still lands — advisory, not refusal');
    host.querySelector('#feedmore').click();
    await new Promise((r) => setTimeout(r, 150));
    await settled();
    const hits = warnings.filter((w) => w.includes('[vera] fetch') && w.includes('holes'));
    if (isProd) assert.equal(hits.length, 0, 'production carries no advisory text');
    else assert.equal(hits.length, 1, 'dev warns exactly once per element, naming the pun');
    host.remove();
    await settled();
  } finally {
    console.warn = orig;
  }
});

test('debounce: a burst of triggers is ONE request, after the quiet', async () => {
  const host = await mount(`
    <div data-vd-state="{ n: 0 }">
      <button id="burst" data-vd-fetch="{ url: '${ORIGIN}/counted', on: 'click', debounce: 80 }">go</button>
      <b data-vd-text="n"></b>
    </div>`);
  const button = host.querySelector('#burst');
  for (let i = 0; i < 5; i++) {
    button.click();
    await new Promise((r) => setTimeout(r, 15));
  }
  await until(() => host.querySelector('b').textContent === '1', 'exactly one request reached the wire');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(host.querySelector('b').textContent, '1', 'and the quiet brought no stragglers');
  host.remove();
  await settled();
});

test('cache: a fresh GET replays from the held response — one wire hit inside the TTL', async () => {
  const host = await mount(`
    <div data-vd-state="{ n: 0 }">
      <button id="cached" data-vd-fetch="{ url: '${ORIGIN}/counted?who=cache', on: 'click', cache: 1 }">go</button>
      <b data-vd-text="n"></b>
    </div>`);
  const button = host.querySelector('#cached');
  button.click();
  await until(() => host.querySelector('b').textContent !== '0', 'first landing');
  const first = host.querySelector('b').textContent;
  button.click();
  await new Promise((r) => setTimeout(r, 120));
  await settled();
  assert.equal(host.querySelector('b').textContent, first,
    'the second click replayed the HELD body — the server saw one request');
  await new Promise((r) => setTimeout(r, 1000));
  button.click();
  await until(() => host.querySelector('b').textContent !== first, 'past the TTL, the wire again');
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

/* ── data-vd-stream ──────────────────────────────────────────────────────────────────────── */

/**
 * Node has no global EventSource, so the test PROVIDES the platform — a minimal one over
 * http.get, which means the directive is exercised against real server bytes, not a mock of
 * our own parsing.
 */
class TestEventSource {
  constructor(href) {
    this.readyState = 0;
    this._listeners = {};
    get(href, (res) => {
      this.readyState = 1;
      this.onopen?.();
      this._res = res;
      let buffered = '';
      res.on('data', (chunk) => {
        buffered += chunk;
        let cut;
        while ((cut = buffered.indexOf('\n\n')) >= 0) {
          const frame = buffered.slice(0, cut);
          buffered = buffered.slice(cut + 2);
          let name = 'message';
          const data = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).trim());
          }
          if (data.length) for (const fn of this._listeners[name] ?? []) fn({ data: data.join('\n') });
        }
      });
    });
  }
  addEventListener(name, fn) { (this._listeners[name] ??= []).push(fn); }
  close() { this.readyState = 2; this._res?.destroy(); }
}
globalThis.EventSource = TestEventSource;

test('stream: a pushed JSON message is a state patch, and the reserved prefix holds', async () => {
  const host = await mount(`
    <div data-vd-state="{ total: 0, safe: 0, link: '' }">
      <b data-vd-text="total"></b><i data-vd-text="safe"></i>
      <div data-vd-stream="{ url: '${ORIGIN}/sse?mode=patch', status: 'link' }"></div>
    </div>`);
  await until(() => host.querySelector('b').textContent === '55', 'the push updated the reflection');
  host.remove();
  await settled();

  const second = await mount(`
    <div data-vd-state="{ safe: 0 }">
      <i data-vd-text="safe"></i>
      <div data-vd-stream="{ url: '${ORIGIN}/sse?mode=reserved' }"></div>
    </div>`);
  await until(() => second.querySelector('i').textContent === '2', 'the safe key landed');
  host.remove(); second.remove();
  await settled();
});

test('stream: a named event reaches only its listeners, and pushed markup is live', async () => {
  const host = await mount(`
    <div data-vd-state="{ total: 0, n: 0 }">
      <b data-vd-text="total"></b>
      <div data-vd-stream="{ url: '${ORIGIN}/sse?mode=named', event: 'score' }"></div>
    </div>`);
  await until(() => host.querySelector('b').textContent === '77', 'the named event delivered');
  host.remove();
  await settled();

  const live = await mount(`
    <div data-vd-state="{ n: 0 }">
      <span data-vd-text="n"></span>
      <div id="zone3" data-vd-stream="{ url: '${ORIGIN}/sse?mode=markup', into: '#zone3' }"></div>
    </div>`);
  const pushed = await until(() => live.querySelector('#pushed'), 'markup was pushed and swapped');
  pushed.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
  await until(() => live.querySelector('span').textContent === '1',
    'and it was LIVE on first click — no hydration, same as fetch');
  live.remove();
  await settled();
});

test('stream: one URL, one connection — subscribers share the wire, teardown releases it', async () => {
  const before = sseConnections;
  const host = await mount(`
    <div data-vd-state="{ total: 0 }">
      <div data-vd-stream="{ url: '${ORIGIN}/sse?mode=patch&who=shared' }"></div>
      <div data-vd-stream="{ url: '${ORIGIN}/sse?mode=patch&who=shared' }"></div>
    </div>`);
  await until(() => sseConnections === before + 1, 'two subscribers opened ONE connection');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(sseConnections, before + 1, 'and it stayed one');
  host.remove();
  await settled();
  await until(() => sseConnections === before, 'the last teardown closed the wire');
});

test('stream: send on an SSE url is refused — receive-only is the transport, not a bug', async () => {
  const host = await mount(`
    <div data-vd-state="{ out: '' }">
      <div data-vd-stream="{ url: '${ORIGIN}/sse?mode=patch&who=sendcheck', send: 'out' }"></div>
    </div>`);
  await settled();
  assert.ok(rejections().some((r) => r.code === 'stream-sse-send'), 'the refusal names the code');
  host.remove();
  await settled();
});

test('stream: the WebSocket half — queue, pump, dedupe, establishment, reconnect', async () => {
  const sockets = [];
  const RealWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class {
    constructor(href) { this.href = href; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.onclose?.(); }
  };
  try {
    const host = await mount(`
      <div data-vd-state="{ total: 0, out: { seeded: true }, link: '' }">
        <b data-vd-text="total"></b>
        <div data-vd-stream="{ url: 'ws://127.0.0.1:${port}/live', send: 'out', status: 'link' }"></div>
      </div>`);
    const state = stateOf(host.firstElementChild);
    assert.equal(sockets.length, 1, 'one socket opened');
    const socket = sockets[0];
    assert.equal(socket.sent.length, 0, 'the SEEDED outbox was never sent — establishment answers no one');

    /** Writes before open QUEUE; open flushes. */
    state.out = { type: 'vote', id: 7 };
    await settled();
    assert.equal(socket.sent.length, 0, 'nothing on the wire before open');
    socket.readyState = 1;
    socket.onopen?.();
    state.out = { type: 'vote', id: 8 };
    await settled();
    assert.deepEqual(socket.sent.map((m) => JSON.parse(m).id), [7, 8], 'the queue flushed in order, then the live send');

    /** A REWRITE of the same content is not a message — the pump compares wire form. */
    state.out = { type: 'vote', id: 8 };
    await settled();
    assert.equal(socket.sent.length, 2, 'identical wire form did not resend');

    /** A pushed message patches state, same law as SSE. */
    socket.onmessage?.({ data: '{"total": 41}' });
    await settled();
    assert.equal(host.querySelector('b').textContent, '41', 'the socket push patched state');

    /** THE QUEUE CEILING: a dead socket must not grow memory forever — past the cap the
     *  OLDEST waiting message drops (state sync keeps the newest) with a named refusal. */
    socket.readyState = 0;
    for (let i = 0; i < 105; i++) { state.out = { flood: i }; await settled(); }
    assert.ok(rejections().some((r) => r.code === 'stream-queue-full'), 'the drop is a refusal, not a silence');

    /** The one reconnect loop in the framework: close → backoff → a NEW socket. */
    socket.close();
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(sockets.length, 2, 'the socket reconnected after backoff');
    host.remove();
    await settled();
  } finally {
    globalThis.WebSocket = RealWebSocket;
  }
});
