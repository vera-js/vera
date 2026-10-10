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

/**
 * Server: render a slot fixture with children, in its own process (the shims own globals).
 * `awaited` picks the asynchronous chain — the synchronous one refuses an async
 * `connectedCallback` by design, since its markup would be empty.
 */
const server = (children, fixture = 'slot-card-ssr', awaited = false, attributes = null) => {
  const entry = awaited ? 'renderToStringAsync' : 'renderToString';
  const script = `
    import { ${entry} } from '@verajs/ssr';
    import { wire } from '@verajs/core';
    const { slots } = await import('@verajs/renderer/slots');
    wire([slots]);
    const out = (await ${entry}(new URL('./tests/fixtures/ssr/${fixture}.js', 'file://' + process.cwd() + '/'), { children: ${JSON.stringify(children)}${attributes ? `, attributes: ${JSON.stringify(attributes)}` : ''} })).html;
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
const { renderInto, renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
const { slots, slotted } = await load('renderer/slots');
const { hydrateSlots } = await load('renderer/hydrate-slots');
wire([renderer, hydration, slots, hydrateSlots]);
const html = (strings, ...values) => ({ strings, values });
// the SAME template the fixture renders
const card = () => html`<article><header><slot name="header"><em>fallback header</em></slot></header><main><slot>default fallback</slot></main></article>`;

/** Server output without the light-tree statement and each filled slot's two region markers, for asserting WHERE the server put things. */
const bare = (markup) => markup.replace(/ data-vm-light="[^"]*"/g, '').replace(/<!--[[\]]-->/g, '');

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
  /** An unfilled slot STAYS, showing its fallback — as a client render keeps it (Brian, 2026-10-02). */
  assert.equal(host.querySelectorAll('slot').length, 2, 'both unfilled slots stay, as the client keeps them');
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
  assert.match(serverHtml, /<ins hidden="" data-vm-unassigned="">/, 'the server parked it, in the client\'s own container');
  const host = hostFromServer(serverHtml);
  const carrier = host.querySelector('[data-vm-unassigned]');
  const p = carrier.querySelector('p');
  renderInto(card(), host);
  await settle();
  /** Unassigned content stays CONNECTED, as under native slots: the carrier IS the client's holding, adopted. */
  assert.equal(host.querySelector('[data-vm-unassigned]'), carrier, 'the carrier is adopted as the holding, by identity');
  assert.equal(carrier.style.getPropertyValue('display'), 'none', 'and hidden as a client-made one is (inline, important)');
  assert.equal(p.parentNode, carrier, 'its content stays in it, by identity');
  assert.equal(slotted(host, 'nowhere').length, 1, 'and is captured, ready for its slot');
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
  const host = hostFromServer(server('<h2 slot="header">MY HEADER</h2>MY BODY'));
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
 * **The server's delimiter must not outlive the adoption it delivered.** `data-vm-slotted`
 * describes what the server emitted; once those nodes are adopted it is meaningless, and leaving
 * it behind puts a framework marker in the user's live DOM permanently. `data-vm-select` sets
 * the precedent — `ssr-select-parity` asserts "the mark must not survive".
 */
test('AUDIT — the light-tree statement is stripped once adopted, and the range markers become the slot\'s region', async () => {
  const serverHtml = server('plain body<b>bold</b>');
  assert.match(serverHtml, /<main><!--\[-->plain body<b>bold<\/b><!--\]--><\/main>/,
    'CONTROL: the server did mark the range (or this test proves nothing)');
  const host = hostFromServer(serverHtml);
  const bBefore = host.querySelector('b');
  const [rs, re] = [host.querySelector('main').firstChild, host.querySelector('main').lastChild];
  renderInto(card(), host);
  await settle();
  assert.equal(host.hasAttribute('data-vm-light'), false, 'the host\'s statement is stripped');
  assert.equal(host.querySelector('main').firstChild, rs, 'the server\'s start marker is the region\'s start, by identity');
  assert.equal(host.querySelector('main').lastChild, re, 'and its end marker the region\'s end');
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
  assert.equal(host.hasAttribute('data-vm-light'), false, 'and no statement is left behind');

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
  assert.match(bare(serverHtml), /<i><b slot="tag">TAG<\/b><\/i>/, 'CONTROL: the server distributed the inner one');
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
  assert.equal(outer.querySelector('[data-vm-light]'), null, 'statements stripped at both levels');
  assert.deepEqual(slotted(inner, 'tag').map((n) => n.textContent), ['TAG'], 'the inner capture map is live');
  outer.remove();
});

/**
 * **The rescue walks the SERVER's subtree, which is full of the user's own markup**, so it may not
 * assume anything about what it finds there. (Originally: `data-vm-unassigned` on a non-`<template>`
 * reached `.content` and threw out of `renderInto`.) The carrier today is `<ins data-vm-unassigned>`,
 * looked for as the host's FIRST child; one anywhere else is ordinary markup.
 */
test('AUDIT — a reserved element out of the carrier\'s place does not break the render', async () => {
  /** Server-shaped (the host states its light tree), with an `<ins data-vm-unassigned>` the server never wrote, NOT first. */
  const host = hostFromServer(
    '<my-host data-vm-light="1:0"><article><header><!--[--><h2 slot="h">KEEP</h2><!--]--></header></article>' +
      '<ins data-vm-unassigned>USER DIV</ins></my-host>'
  );
  /** Disagrees at the root, so the rescue runs over that subtree. */
  renderInto(html`<section><header><slot name="h">fb</slot></header></section>`, host);
  await settle();
  assert.equal(host.querySelector('section > header').textContent, 'KEEP', 'the fallback render completed');
  assert.equal(host.querySelector('article'), null, 'and the server markup was replaced');
  host.remove();
});

/**
 * **A slot's own bindings, through the server and back.** The hydrator walks the canonical template
 * against the server's DOM; for a `<slot>` there is no live element to adopt (the server unwrapped
 * it), and the template's parts FOR that slot were skipped rather than accounted. Every value after
 * the slot then read the wrong one, adoption failed, and the whole container fell back to a client
 * render — so no component whose slot carried `@slotchange`, `&ref` or `name=${…}` could be server
 * rendered at all. The parts now commit onto a per-instance clone of the slot, which both keeps the
 * values aligned and makes that element mean here what it means in a client render.
 */
test('AUDIT — a slot carrying bindings hydrates in place, and its API is live', async () => {
  const serverHtml = server('<h2 slot="header">MINE</h2>', 'slot-bound-ssr');
  assert.match(bare(serverHtml), /<header><h2 slot="header">MINE<\/h2><\/header>/,
    'CONTROL: the server routed the dynamic name');
  const host = hostFromServer(serverHtml);
  const before = host.querySelector('h2');

  let fires = 0;
  let seen = null;
  let held = null;
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    renderInto(
      html`<header><slot name=${'header'} &ref=${(node) => { held = node; }}
        @slotchange=${(event) => { fires++; seen = event.target.assignedElements().map((n) => n.textContent); }}
      >no header</slot></header><footer>${'AFTER'}</footer>`,
      host
    );
    await settle();
  } finally {
    console.warn = original;
  }

  assert.deepEqual(warnings.filter((w) => w.includes('hydration-fallback')), [],
    'adoption succeeded — the values after the slot line up');
  assert.equal(host.querySelector('h2'), before, 'and the server node kept its identity');
  assert.equal(host.querySelector('footer').textContent, 'AFTER', 'the value after the slot is its own');
  assert.equal(fires, 1, 'slotchange fired once for the assignment it was hydrated with');
  assert.deepEqual(seen, ['MINE']);
  assert.equal(held?.localName, 'slot', '&ref hands over this instance\'s slot element');
  assert.deepEqual(held.assignedNodes().map((n) => n.textContent), ['MINE'], 'which reads the live assignment');

  /** And it is live afterwards, exactly as a client-rendered one is. */
  const added = dom.window.document.createElement('h2');
  added.setAttribute('slot', 'header');
  added.textContent = 'TWO';
  host.appendChild(added);
  await settle();
  assert.equal(fires, 2, 'and keeps firing');
  assert.deepEqual(seen, ['MINE', 'TWO']);
  host.remove();
});

/**
 * **Three levels of composition, hydrated.** Each host is simultaneously somebody's slotted content
 * and somebody else's host, and the server's output for that shape has to be adoptable at every
 * level at once — one bail anywhere would discard a whole subtree and take the levels below it.
 */
test('AUDIT — three levels of light-slot components hydrate in place, all at once', async () => {
  const serverHtml = server(
    '<i slot="x">A-NAMED</i><deep-b slot=""><i slot="x">B-NAMED</i><deep-c><i slot="x">C-NAMED</i></deep-c></deep-b>',
    'slot-deep-ssr',
    /* awaited */ true
  );
  assert.match(bare(serverHtml), /<c><i slot="x">C-NAMED<\/i><\/c>/, 'CONTROL: the server distributed all three levels');
  const host = hostFromServer(serverHtml);
  const innermost = host.querySelector('i[slot="x"]');

  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    renderInto(html`<a1><slot name="x">no-a</slot></a1><a2><slot>no-a-default</slot></a2>`, host);
    renderInto(html`<b1><slot name="x">no-b</slot></b1><b2><slot>no-b-default</slot></b2>`, host.querySelector('deep-b'));
    renderInto(html`<c><slot name="x">no-c</slot></c>`, host.querySelector('deep-c'));
    await settle();
  } finally {
    console.warn = original;
  }

  assert.deepEqual(warnings.filter((w) => w.includes('hydration-fallback')), [],
    'no level bailed — a bail at any of them would take the levels below it too');
  assert.equal(host.querySelector('i[slot="x"]'), innermost, 'node identity kept through the whole depth');
  assert.equal(host.querySelector('a1').textContent, 'A-NAMED');
  assert.equal(host.querySelector('b1').textContent, 'B-NAMED');
  assert.equal(host.querySelector('c').textContent, 'C-NAMED');
  assert.equal(host.querySelector('[data-vm-light]'), null, 'and every statement is stripped');
  host.remove();
});

/**
 * **The light-tree statement and the range markers are parsed out of markup, and markup is not trustworthy.**
 *
 * `data-vm-light` and the `[`/`]` markers are the server's own hand-off, but the reader takes them from whatever is in the
 * page — a user can paste content carrying them, a proxy can mangle them. A statement indexes ranges and counts nodes,
 * which is exactly the shape that hangs, throws, or quietly captures somebody else's nodes when the values are hostile.
 * Every case must complete, replace the server markup, and claim no node the host did not contain. (Rewritten 2026-10-07
 * for the marker format: the old rows set `data-vm-slotted`, which nothing reads any more, so they measured nothing.)
 */
for (const [label, light, main] of [
  ['a run far beyond its range', '1:0*999999', '<!--[-->USER<!--]-->'],
  ['a negative index', '1:-5', '<!--[-->USER<!--]-->'],
  ['non-numeric runs', '1:abc,def', '<!--[-->USER<!--]-->'],
  ['an empty statement over a filled range', '1:', '<!--[-->USER<!--]-->'],
  ['an overflowing exponent', '1:1e400', '<!--[-->USER<!--]-->'],
  ['an index past every range', '1:9', '<!--[-->USER<!--]-->'],
  ['hostile run counts', '1:0*-1,0*abc,0*1e400', '<!--[-->USER<!--]-->'],
  ['an unpaired start', '1:0', '<!--[-->USER'],
  ['a stray end', '1:0', 'USER<!--]-->'],
  ['nested starts', '1:0', '<!--[--><!--[-->USER<!--]-->'],
  ['a conditional-comment look-alike', '1:0', '<!--[if IE]>-->USER<!--]-->'],
  /** The format number: another release's, and none at all (the pre-number format). */
  ['a foreign format number', '2:0', '<!--[-->USER<!--]-->'],
  ['no format number', '0', '<!--[-->USER<!--]-->'],
])
  test(`AUDIT — a hostile light statement or marker (${label}) degrades safely`, async () => {
    /** Stated, as server output is — an unstated component host is client-made and never reads marks. */
    const host = dom.window.document.createElement('my-host');
    host.setAttribute('data-vm-light', light);
    /** Hand-written on purpose: hostile statements and marks are what no server writes. */
    host.innerHTML = `<article><main>${main}</main></article>`;
    dom.window.document.getElementById('root').appendChild(host);
    /** Disagrees at the root, so the rescue reads the marks on the way to a clean render. */
    renderInto(html`<section><main><slot>fb</slot></main></section>`, host);
    await settle();
    assert.ok(host.querySelector('section'), 'the render completed rather than throwing');
    assert.equal(host.querySelector('article'), null, 'and the server markup was replaced');
    /** Nothing may be claimed that the element did not contain: one text node at most. */
    assert.ok(slotted(host, '').length <= 1, `claimed ${slotted(host, '').length} nodes from a one-child element`);
    host.remove();
  });

/**
 * **A filled slot right after the component's own content** (2026-10-07: the marker format has no offset — the markers
 * ARE the boundary — so this row now asserts the rescue keeps exactly the range, never the component's PREFIX).
 *
 * Originally: the OFFSET half of `data-vm-slotted="offset,count"`, which nothing exercised.
 *
 * The mark tells a failed adoption which of the parent's children were the user's. Adoption itself
 * only needs the count — the walk is already standing in the right place — so the offset is used by
 * exactly one path: the rescue that runs when hydration bails. It is non-zero only when the default
 * slot has siblings BEFORE it in the same parent, and no fixture produced that shape, so forcing
 * the offset to 0 passed the entire suite.
 *
 * What it costs: with a wrong offset the rescue slices the wrong range and keeps the COMPONENT's
 * own static content while discarding the user's — measured on the fixture below, which rescued
 * "PREFIX" instead of "USER BODY". A silent swap of one for the other, on the path whose warning
 * promises the page is still correct.
 */
test('AUDIT — a non-zero slotted offset rescues the user content, not the component\'s', async () => {
  const serverHtml = server('USER BODY', 'slot-offset-ssr');
  assert.match(serverHtml, /<i>PREFIX<\/i><!--\[-->USER BODY<!--\]-->/, `CONTROL: the range follows the component's own content: ${serverHtml}`);

  const host = hostFromServer(serverHtml);
  /** Disagrees at the root, so the bail runs and the rescue reads the mark. */
  renderInto(html`<section><main><slot>fb</slot></main></section>`, host);
  await settle();
  assert.deepEqual(
    slotted(host, '').map((node) => (node.data ?? node.textContent).trim()),
    ['USER BODY'],
    "the rescue kept the user's content"
  );
  assert.doesNotMatch(host.textContent, /PREFIX/, "and did not mistake the component's own markup for it");
  host.remove();
});

/**
 * **Serialization is where node identity dies, and the mark counts nodes.**
 *
 * `data-vm-slotted="offset,count"` addresses the user's content by position among the parent's
 * children — as they are ON THE SERVER. The client's parser joins adjacent text into one node, so
 * wherever the user's slotted text touches text the component contributed, the mark addresses a
 * node spanning a boundary it cannot see. Both edges break, and each corrupts a different reader:
 *
 * - TRAILING breaks adoption's count. Measured: `<main><slot>fb</slot> TAIL</main>` served
 *   "BODY TAIL" and hydrated to "BODY TAIL TAIL" — the static text adopted a second time.
 * - LEADING breaks the offset, which only `rescue` reads, so a hydration bail would slice the
 *   wrong range and keep the component's own markup while discarding the user's.
 *
 * The server emits a separator comment at any boundary that would merge — the side that KNOWS,
 * rather than having hydration infer it from the canonical template. The inference works, and was
 * built first, but needs a fresh case for everything that can follow a slot (static text, a second
 * default slot's fallback, a named slot's fallback, and whether that named slot receives content
 * at all); one rule removes the class instead of handling its members. React spends the same 7
 * bytes for the same reason.
 *
 * All four shapes below produced corrupted hydration before the fix, and each names a different
 * neighbor, which is what makes them worth having as four rather than one.
 */
for (const [shape, want] of [
  ['tail', 'BODY TAIL'],
  ['lead', 'LEAD BODY'],
  ['named', 'BODYXF'],
  ['dup', 'BODYSECOND-FB'],
])
  test(`AUDIT — slotted text adjacent to the component's own text hydrates intact (${shape})`, async () => {
    const serverHtml = server('BODY', 'slot-adjacent-ssr', false, { shape });
    const served = /<main[^>]*>([\s\S]*?)<\/main>/.exec(serverHtml)?.[1] ?? '';
    assert.match(served, /<!--\[-->BODY<!--\]-->/, 'CONTROL: the range markers separate the text that would merge');
    /** Text, not markup: an unfilled slot stays as its element, showing its fallback (Brian, 2026-10-02). */
    assert.equal(served.replace(/<[^>]*>/g, ''), want, 'CONTROL: and served the right text');

    const host = hostFromServer(serverHtml);
    renderInto(SHAPES[shape](), host);
    await settle();
    assert.equal(host.querySelector('main').textContent, want, 'hydration neither duplicated nor dropped it');
    host.remove();
  });

/**
 * **The BAIL path for the same shapes, which reads the offset rather than the count.**
 *
 * Adoption uses only the count; the offset has exactly one reader, the rescue that runs when
 * hydration falls back. So a mark whose offset is wrong passes every hydration test and loses the
 * user's content only on the path whose warning promises the page is still correct.
 *
 * This exists because the separator fix broke it: inserting a comment ahead of the user's content
 * shifted it one place right, while the offset had already been computed in the loop above — so
 * the rescue sliced the separator and kept nothing, and the page fell back to the component's own
 * fallback with the user's content gone. The mark is now written after the nodes stop moving, and
 * this is the test that says so.
 */
for (const [shape, want] of [
  ['lead', 'BODY'],
  ['tail', 'BODY'],
])
  test(`AUDIT — a hydration bail rescues the user's content across a separator (${shape})`, async () => {
    const host = hostFromServer(server('BODY', 'slot-adjacent-ssr', false, { shape }));
    /** Disagrees at the root, so the bail runs and the rescue reads the offset. */
    renderInto(html`<section><main><slot>fb</slot></main></section>`, host);
    await settle();
    assert.deepEqual(
      slotted(host, '').map((node) => (node.data ?? node.textContent)),
      [want],
      "the rescue kept the user's content, not the separator beside it"
    );
    host.remove();
  });

/** The client templates, matching the fixture's shapes exactly — hydration compares against these. */
const SHAPES = {
  tail: () => html`<article><main><slot>fb</slot> TAIL</main></article>`,
  lead: () => html`<article><main>LEAD <slot>fb</slot></main></article>`,
  named: () => html`<article><main><slot>fb</slot><slot name="x">XF</slot></main></article>`,
  dup: () => html`<article><main><slot>FIRST-FB</slot><slot>SECOND-FB</slot></main></article>`,
};

/**
 * **Deploy skew preserves EVERYTHING — unnamed content and bare text included, not just the named
 * nodes the older mismatch tests used.** The client's template changed since the server rendered
 * (the realistic mismatch: a deploy between render and load), adoption bails, and the rescue reads
 * the `data-vm-slotted` marks — which is why it can save content that carries no `slot`
 * attribute and could never be told apart from template output by inspection. Identity is asserted,
 * not just text: a rescue that re-created equivalent nodes would pass a textContent check while
 * breaking every reference the page holds.
 */
test('AUDIT — a template-changed mismatch preserves unnamed content and bare text, with identity', async () => {
  const serverHtml = server('<h2 slot="header">named</h2><span>plain</span>bare text');
  const host = hostFromServer(serverHtml);
  const h2 = host.querySelector('h2');
  const span = host.querySelector('span');
  const changed = () => html`<article class="v2"><header><slot name="header"><em>fallback header</em></slot></header><main><slot>default fallback</slot></main></article>`;
  renderInto(changed(), host);
  await settle();

  assert.equal(host.querySelector('h2'), h2, 'the named node survived, same identity');
  assert.equal(host.querySelector('span'), span, 'the UNNAMED element survived, same identity');
  assert.equal(host.querySelector('main').textContent.replace(/\s+/g, ' ').trim(), 'plainbare text'.replace(/\s+/g, ' ').trim(),
    'and the bare text is on screen, not parked or gone');
  assert.deepEqual(slotted(host).map((n) => n.textContent), ['plain', 'bare text'],
    'the capture map holds the default slot — the system is live, not just visually right');

  /** Live after the skew: the whole point of the rescue is a working first client render. */
  host.querySelector('h2').remove();
  await settle();
  assert.equal(host.querySelector('header').textContent, 'fallback header');
  host.remove();
});

/**
 * **A component the server did not render is rendered, not hydrated — and loses nothing.** Under an
 * app-wide hydrate renderer, every light component created on the client (by a template, by the
 * user, inside `serializeTemplate` markup) reaches hydration's first render with its LIGHT children
 * in it. Adopting them as its render failed and discarded them: all of an unnamed child, and all of a
 * named one before the `slot`-attribute heuristic kept those. With slots wired the server states the
 * light tree on every component host it renders, so a custom element without that statement is known
 * to be client-made, and gets a client first render: named and unnamed survive, with identity, and
 * nothing claims a mismatch because there was none.
 */
test('AUDIT — non-server children: a client-made component keeps every child, named and unnamed, silently', async () => {
  const host = dom.window.document.createElement('mm-host');
  /** Hand-written on purpose: client-made children are, by definition, not server output. */
  host.innerHTML = '<h2 slot="header">named</h2><span>plain</span>bare';
  dom.window.document.getElementById('root').appendChild(host);
  const h2 = host.querySelector('h2');
  const span = host.querySelector('span');

  const said = [];
  const original = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    renderInto(card(), host);
    await settle();
  } finally {
    console.warn = original;
  }

  assert.equal(host.querySelector('header h2'), h2, 'the named node, same identity, distributed');
  assert.equal(host.querySelector('main span'), span, 'the unnamed one too');
  assert.equal(host.querySelector('main').textContent, 'plainbare', 'and the bare text');
  assert.deepEqual(said.filter((line) => line.includes('hydration-fallback')), [], 'no mismatch is reported, because there was none');
  host.remove();
});

/** The same through a template: a light component created by a client render inside a hydrated app. */
test('AUDIT — non-server children: a light component a client template creates keeps its content', async () => {
  const host = dom.window.document.createElement('div');
  dom.window.document.getElementById('root').appendChild(host);
  const inner = () => html`<mm-inner><b>mine</b> text</mm-inner>`;
  renderInto(inner(), host);
  const created = host.querySelector('mm-inner');
  renderInto(card(), created);
  await settle();
  assert.equal(created.querySelector('main').textContent, 'mine text', 'distributed, not discarded');
  host.remove();
});

/**
 * **The fallback-fragment lifecycle, post-hydration, through multiple round trips.** The CSR
 * mutation fuzz found three defects in this lifecycle client-side; hydration builds the same
 * bindings on its own branch (`adoptSlot`), where the invariant splits: an ASSIGNED slot's
 * fallback is clones, displaced from birth into the fragment, while an unassigned slot's fallback
 * is live server output the fragment must not touch. Measured against a genuine CSR control under
 * nine identical mutation steps — remove/re-add twice over, re-slot out and back, empty both —
 * with zero divergence; this pins the double round trip, which is the step that exercises
 * restore-after-REdisplacement, where a stale restore list would show its age.
 */
test('AUDIT — hydrated fallback survives repeated displacement round trips and re-slotting', async () => {
  const serverHtml = server('<h2 slot="header">Hi</h2><span>body</span>');
  const host = hostFromServer(serverHtml);
  renderInto(card(), host);
  await settle();

  const header = () => host.querySelector('header').textContent;
  host.querySelector('h2').remove();
  await settle();
  assert.equal(header(), 'fallback header', 'round trip 1: restore');

  const again = dom.window.document.createElement('h2');
  again.setAttribute('slot', 'header');
  again.textContent = 'Back';
  host.appendChild(again);
  await settle();
  assert.equal(header(), 'Back', 'round trip 2: displace again');

  again.remove();
  await settle();
  assert.equal(header(), 'fallback header', 'round trip 3: restore from the SECOND displacement');

  again.textContent = 'Again';
  host.appendChild(again);
  await settle();
  again.setAttribute('slot', '');
  await settle();
  assert.equal(header(), 'fallback header', 're-slot away: named fallback holds');
  assert.ok(host.querySelector('main').textContent.includes('Again'), 'and the node joined the default slot');
  host.remove();
});

/**
 * **Branch-away after adoption parks the user's content; branch-back restores it.** The defect
 * this pins: every CLIENT path that creates removal work raises `notifyOnRemoval` where the work
 * is created, and the ADOPTION walk did not — so a page whose only seams were adopted never ran
 * `_teardown` on clear, `_$park$` never rescued, and the user's server-rendered slotted node was
 * destroyed inside the discarded card on the FIRST branch-away (found run 3 pass 1, by finally
 * building the true-adoption park probe the register asked for). The template swap goes through
 * the same call sites an app's conditional render uses; identity is asserted at every step
 * because a rebuilt lookalike passes every textContent read.
 */
test('adopted content survives a branch-away and returns on branch-back', async () => {
  const serverHtml = server('<h2 slot="header">Mine</h2>');
  const host = hostFromServer(serverHtml);
  const item = host.querySelector('h2');
  renderInto(card(), host);
  await settle();
  assert.equal(host.querySelector('h2'), item, 'CONTROL: adoption kept the server node');

  renderInto(html`<p>away</p>`, host);
  await settle();
  /** Parked content stays CONNECTED, in the hidden holding, as under native slots (option 4). */
  assert.equal(item.parentNode, host.querySelector('[data-vm-unassigned]'), 'branched away: the node is parked in the holding');
  assert.equal(host.querySelector('[data-vm-unassigned]').style.getPropertyValue('display'), 'none', 'which is hidden');
  assert.equal(host.querySelector('p').textContent, 'away', 'and the branch actually rendered');

  renderInto(card(), host);
  await settle();
  assert.equal(host.querySelector('h2'), item, 'branch-back restored the SAME node');
  assert.equal(host.querySelector('header').textContent, 'Mine', 'into its slot');
  host.remove();
});

/**
 * The fallback warning promises "other containers on the page hydrate independently and are
 * unaffected" — and mismatch cleanup parks THROUGH the module-level `_adoptedSlots` array, which
 * is exactly the shape that could park another container's seams if its reset discipline slipped.
 * A adopts clean; B (same server markup, poisoned with trailing junk) mismatches AFTER its slot
 * adopted. B's own user content must survive its fallback (the rescue), and A must stay assigned
 * AND live — the post-cleanup write is the half a static read cannot see.
 */
test('a mismatching container parks only its own seams', async () => {
  const hostA = hostFromServer(server('<u slot="header">A-mine</u>'));
  const itemA = hostA.querySelector('u');
  renderInto(card(), hostA);
  await settle();
  assert.ok(hostA.querySelector('header').contains(itemA), 'CONTROL: A adopted');

  const hostB = hostFromServer(server('<u slot="header">B-mine</u>'));
  hostB.appendChild(dom.window.document.createElement('table'));
  renderInto(card(), hostB);
  await settle();
  assert.ok(hostB.querySelector('header').textContent.includes('B-mine'),
    'B fell back and its user content survived the rebuild');

  assert.ok(hostA.querySelector('header').contains(itemA), 'A untouched by B\'s cleanup');
  itemA.textContent = 'A-live';
  await settle();
  assert.ok(hostA.querySelector('header').textContent.includes('A-live'), 'and A is still LIVE');
  hostA.remove(); hostB.remove();
});

/**
 * Adopted seams are RANKED, so a re-slot after hydration lands in light-tree order — not the
 * arrival order an unranked adopted node produced. Run 18 found adopted nodes carried no rank
 * (only the client capture path ranked), so every later rank-ordered merge compared against
 * undefined. Settled sequence here; the same regime under a same-frame STORM has a known residual
 * recorded in the portal register.
 */
test('a re-slot after hydration keeps light-tree order among adopted and added nodes', async () => {
  const serverHtml = server('<u slot="header">H0</u>');
  const host = hostFromServer(serverHtml);
  const h0 = host.querySelector('u');
  renderInto(card(), host);
  await settle();
  const add = (t) => { const u = dom.window.document.createElement('u'); u.setAttribute('slot', 'header'); u.textContent = t; host.appendChild(u); return u; };
  const x1 = add('x1'); await settle();
  add('x2'); await settle();
  assert.deepEqual(slotted(host, 'header').map((n) => n.textContent), ['H0', 'x1', 'x2'], 'CONTROL: adopted + added, in order');
  x1.setAttribute('slot', 'z'); await settle();
  x1.setAttribute('slot', 'header'); await settle();
  assert.deepEqual(slotted(host, 'header').map((n) => n.textContent), ['H0', 'x1', 'x2'],
    'the re-slotted node returned to its light-tree position, not the tail');
  assert.equal(host.querySelector('header').textContent.replace(/\s+/g, ''), 'H0x1x2');
  void h0;
  host.remove();
});

/**
 * The run-27 deterministic regression: a reslot from one slot to another, on an adopted seam,
 * where the destination slot's fill runs while the node is still PHYSICALLY in its old slot's
 * run. fill's "user took this node" purge misread that other-run position as a user adoption and
 * dropped the node (the storm fuzz found it via concurrent DOM churn shifting observer delivery;
 * this is the minimal deterministic form). The node must survive a default→header round trip made
 * across the storm's timing. Reads only at the end — a mid-sequence read masks it by settling.
 */
test('a node reslotted between slots on an adopted seam is placed, never purged', async () => {
  const host = hostFromServer(server('<u slot="header">H0</u>'));
  const h0 = host.querySelector('u');
  renderInto(card(), host);
  await settle();
  renderInto(html`<p>away</p>`, host); await settle();   // park
  h0.setAttribute('slot', ''); await settle();            // reslot H0 -> default (while parked)
  const x1 = dom.window.document.createElement('u'); x1.setAttribute('slot', 'header'); x1.textContent = 'x1'; host.append(x1); await settle();
  renderInto(card(), host); await settle();               // back
  x1.setAttribute('slot', ''); await settle();            // reslot x1 -> default
  renderInto(card(), host); await settle();
  h0.setAttribute('slot', 'header'); await settle();      // reslot H0 -> header: must NOT be purged
  assert.deepEqual(slotted(host, 'header').map((n) => n.textContent), ['H0'],
    'the reslotted node landed in its new slot, not dropped by the purge guard');
  assert.equal(host.querySelector('header').textContent.replace(/\s+/g, ''), 'H0');
  host.remove();
});

/**
 * A hydrated light component's OWN top-level `${…}` updates after adoption. Adopted markers never pass
 * through an insert, so an ownership test keyed on a stamped marker read the component's own new
 * output as the user's content and captured it: `${busy ? loading() : list()}` emptied on update.
 */
test("a hydrated light component's own top-level expression updates after adoption", async () => {
  const host = hostFromServer(server('<h2 slot="a">MINE</h2>', 'slot-toplevel-ssr'));
  const mine = host.querySelector('h2');
  const loading = () => html`<p class="spin">loading</p>`;
  const list = () => html`<ul><li>one</li><li>two</li></ul>`;
  const draw = (busy) => html`<article><slot name="a">fb</slot></article>${busy ? loading() : list()}`;
  renderInto(draw(true), host);
  await settle();
  assert.equal(host.querySelector('h2'), mine, 'CONTROL: adopted, node identity kept');
  assert.ok(host.querySelector('p.spin'), 'CONTROL: the server output is there');
  renderInto(draw(false), host);
  await settle();
  assert.equal(host.querySelectorAll('li').length, 2, 'the update shows the list');
  assert.equal(host.querySelector('article li'), null, 'and none of it went into the slot');
  renderInto(draw(true), host);
  await settle();
  assert.ok(host.querySelector('p.spin'), 'and back');
  host.remove();
});

/**
 * A hydrated light component whose `<slot>` only appears in a LATER state. Hydration adopted no slot,
 * so slots first meets the host at that takeover: lifting its children then put the component's own
 * output inside its own slot, and the renderer threw `HierarchyRequestError` with the host emptied.
 * With content no slot claimed on the server, the `data-vm-unassigned` carrier also failed the
 * adoption outright — the whole hydration was thrown away.
 */
test('a hydrated component whose <slot> appears later: no throw, no fallback render, the content arrives', async () => {
  const opened = () => html`<slot>FB</slot>`;
  const draw = (open) => html`<header>HEAD</header><div class="body">${open ? opened() : null}</div><footer>FOOT</footer>`;
  const said = [];
  const original = console.warn;
  console.warn = (message) => said.push(String(message));
  try {
    const empty = hostFromServer(server('', 'slot-late-ssr'));
    const header = empty.querySelector('header');
    renderInto(draw(false), empty);
    await settle();
    assert.equal(empty.querySelector('header'), header, 'CONTROL: adopted in place');
    renderInto(draw(true), empty);
    await settle();
    assert.equal(empty.querySelector('.body').textContent, 'FB', 'the late slot shows its fallback');
    assert.equal(empty.querySelector('header').textContent, 'HEAD', "and the component's output is still its own");
    empty.remove();
    const given = hostFromServer(server('<b>MINE</b>', 'slot-late-ssr'));
    const kept = given.querySelector('header');
    renderInto(draw(false), given);
    await settle();
    assert.equal(given.querySelector('header'), kept, 'adopted, not rebuilt, with the unassigned carrier present');
    renderInto(html`<p>elsewhere</p>`, given);
    renderInto(draw(true), given);
    await settle();
    assert.equal(given.querySelector('.body b')?.textContent, 'MINE', 'the parked content arrives when its slot does, through a template swap');
    given.remove();
  } finally {
    console.warn = original;
  }
  assert.deepEqual(said.filter((m) => m.includes('hydration-fallback')), [], 'no hydration fallback');
});
