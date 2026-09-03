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

/** Server: render a slot fixture with children, in its own process (the shims own globals). */
const server = (children, fixture = 'slot-card-ssr') => {
  const script = `
    import { renderToString } from '@verajs/ssr';
    import { wire } from '@verajs/core';
    const { slots } = await import('@verajs/renderer/slots');
    wire([slots]);
    const out = (await renderToString(new URL('./tests/fixtures/ssr/${fixture}.js', 'file://' + process.cwd() + '/'), { children: ${JSON.stringify(children)} })).html;
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

test('AUDIT — hydration recovers server-parked unassigned content into the capture map', async () => {
  const serverHtml = server('<h2 slot="header">Hi</h2><p slot="nowhere">Recovered</p>');
  assert.ok(serverHtml.includes('data-vera-unassigned'), 'the server parked it');
  const host = hostFromServer(serverHtml);
  renderInto(card(), host);
  await settle();
  assert.equal(host.querySelector('template[data-vera-unassigned]'), null, 'the carrier is consumed');
  assert.equal(slotted(host, 'nowhere').length, 1, 'and its content is captured, ready for its slot');
  assert.equal(host.textContent.includes('Recovered'), false, 'still unrendered, as native leaves it');
});

test('AUDIT — a hydration MISMATCH must not destroy slotted content (the entry\'s own invariant)', async () => {
  /**
   * hydrate.ts promises "correctness never depends on the server markup" — any mismatch clears and
   * re-renders. For slot components that promise was broken: the abandoned attempt left its
   * bindings registered, so the clean render\'s bindings ranked as later duplicates and showed
   * fallback while the user\'s content sat in the discarded tree. Bailing now parks what it
   * adopted, returning the nodes to holding for the fresh render to redistribute — and, for the
   * slots it never reached, `_$rescue$` lifts the user\'s nodes out before the discard.
   */
  const host = dom.window.document.createElement('div');
  host.innerHTML =
    '<article><header><h2 slot="header">MY HEADER</h2></header>' +
    '<main data-vera-slotted="0,1">MY BODY</main></article>';
  dom.window.document.getElementById('root').appendChild(host);
  // a client template the server never produced (version skew / state difference)
  renderInto(html`<article><header><slot name="header">fbh</slot></header><main><slot>fbd</slot></main><footer>NEW</footer></article>`, host);
  await settle();
  assert.ok(host.textContent.includes('MY HEADER'), 'named slot content survived the mismatch');
  assert.ok(host.textContent.includes('MY BODY'), 'default slot content survived the mismatch');
  assert.ok(host.textContent.includes('NEW'), 'and the client template rendered');
  assert.equal(host.querySelector('slot'), null, 'distributed, not left as slot elements');
  host.remove();
});

/**
 * **The server's delimiter must not outlive the adoption it delivered.** `data-vera-slotted`
 * describes what the server emitted; once those nodes are adopted it is meaningless, and leaving
 * it behind puts a framework marker in the user's live DOM permanently. `data-vera-select` sets
 * the precedent — `ssr-select-parity` asserts "the mark must not survive".
 */
test('AUDIT — the data-vera-slotted delimiter is stripped once adopted', async () => {
  const serverHtml = server('plain body<b>bold</b>');
  assert.match(serverHtml, /<main data-vera-slotted="0,2">/,
    'CONTROL: the server did emit the mark, on the slot\'s parent (or this test proves nothing)');
  const host = hostFromServer(serverHtml);
  const bBefore = host.querySelector('b');
  renderInto(card(), host);
  await settle();
  assert.equal(host.querySelector('[data-vera-slotted]'), null, 'and the hydrator strips it');
  assert.equal(host.querySelector('b'), bBefore, 'while still adopting in place — identity preserved');
  assert.equal(slotted(host).length, 2, 'and the capture map holds both default nodes');
});

/**
 * **The mismatch that happens BEFORE the walk reaches a slot** — the broader half of the same
 * invariant. Parking rescues slots the attempt already adopted; when the two renders disagree at
 * the root, nothing has been adopted and there is nothing to park, so the discard took the user's
 * content with it. It was the worst possible shape of bug: content gone from the page for good,
 * under a warning that said the page was still correct.
 *
 * `_$rescue$` un-distributes first, using the only two things the server states — a named node
 * carries its own `slot`, and the default slot's parent carries `offset,count` — and the clean
 * render then captures the host's children exactly as it would on a first client render.
 */
test('AUDIT — a mismatch BEFORE any slot is adopted still keeps every slotted node', async () => {
  const serverHtml = server('<h2 slot="header">USER HEADER</h2>USER BODY<b>B</b><p slot="nowhere">ORPHAN</p>');
  assert.match(serverHtml, /<article>/, 'CONTROL: the server rendered <article> for the drift below to disagree with');
  const host = hostFromServer(serverHtml);
  /** Disagrees at the very first element, so adoption dies before any slot. */
  renderInto(html`<section><header><slot name="header"><em>fb</em></slot></header><main><slot>dfb</slot></main></section>`, host);
  await settle();
  assert.ok(host.textContent.includes('USER HEADER'), 'named content survived');
  assert.ok(host.textContent.includes('USER BODY'), 'default text survived');
  assert.ok(host.querySelector('b'), 'and the rest of the default run');
  assert.equal(host.querySelector('section > header > h2').textContent, 'USER HEADER', 'redistributed, not merely present');
  assert.equal(host.querySelector('[data-vera-slotted]'), null, 'and no marker is left behind');

  /** Live afterwards, like any client render — and content for a slot this state does not have
   *  is in holding rather than destroyed. */
  host.querySelector('h2').remove();
  await settle();
  assert.equal(host.querySelector('header').textContent, 'fb', 'fallback returns');
  renderInto(html`<section><aside><slot name="nowhere">none</slot></aside></section>`, host);
  await settle();
  assert.equal(host.querySelector('aside').textContent, 'ORPHAN',
    'the unclaimed node survived the bail in holding and appears when its slot does');
  host.remove();
});

/**
 * **Nesting hydrates too** — a light-slot component slotted inside another, adopted in place at
 * both levels. This is the end of the chain the server-side nesting fix opened: the inner
 * component now receives its children on the server, distributes them, and the markup it produces
 * is what the client would have produced, so adoption succeeds instead of falling back.
 */
test('AUDIT — nested light-slot components hydrate in place, both levels', async () => {
  const serverHtml = server(
    '<h2 slot="header">OUTER HEAD</h2><slot-inner-ssr><b slot="tag">TAG</b>INNER BODY</slot-inner-ssr>',
    'slot-nested-ssr'
  );
  assert.match(serverHtml, /<i><b slot="tag">TAG<\/b><\/i>/, 'CONTROL: the server distributed the inner one');
  const outer = hostFromServer(serverHtml);
  const inner = outer.querySelector('slot-inner-ssr');
  const tagBefore = outer.querySelector('b[slot="tag"]');

  renderInto(html`<article><header><slot name="header">no header</slot></header><main><slot>no body</slot></main></article>`, outer);
  renderInto(html`<i><slot name="tag">no tag</slot></i><u><slot>no body</slot></u>`, inner);
  await settle();

  assert.equal(outer.querySelector('b[slot="tag"]'), tagBefore, 'the inner node kept its identity');
  assert.equal(outer.querySelector('header').textContent, 'OUTER HEAD');
  assert.equal(inner.querySelector('i').textContent, 'TAG', 'inner named slot adopted');
  assert.equal(inner.querySelector('u').textContent, 'INNER BODY', 'inner default slot adopted');
  assert.equal(outer.querySelector('[data-vera-slotted]'), null, 'markers stripped at both levels');
  assert.deepEqual(slotted(inner, 'tag').map((n) => n.textContent), ['TAG'], 'the inner capture map is live');
  outer.remove();
});
