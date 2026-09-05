/**
 * Light-DOM slot HYDRATION — REAL @verajs/ssr distributed markup (subprocess, its shims own
 * globals) adopted by the real hydrate build + slots module in jsdom. The promise: the server's
 * distributed DOM SURVIVES (node identity preserved — no re-render), and the slot system comes
 * alive (fallback returns on removal, re-slotting works) exactly as a fresh client render.
 */
import { load, isProduction } from './dist.mjs';
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

/**
 * **The rescue walks the SERVER's subtree, which is full of the user's own markup**, so it may not
 * assume anything about what it finds there. `data-vera-unassigned` on an element that is not a
 * `<template>` reached `.content` on an element that has none — a TypeError thrown straight out of
 * `renderInto`, so the mismatch never finished falling back and the page was left with no client
 * render at all. Reserved attribute or not, a page's markup cannot be allowed to do that.
 */
test('AUDIT — a reserved marker on a non-template element does not break the render', async () => {
  const host = dom.window.document.createElement('my-host');
  host.innerHTML =
    '<article><header><h2 slot="h">KEEP</h2></header>' +
    '<aside><div data-vera-unassigned>USER DIV</div></aside></article>';
  dom.window.document.getElementById('root').appendChild(host);
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
  assert.match(serverHtml, /<header><h2 slot="header">MINE<\/h2><\/header>/,
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

  assert.deepEqual(warnings.filter((w) => w.includes('fell back to a client render')), [],
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
  assert.match(serverHtml, /<c><i slot="x">C-NAMED<\/i><\/c>/, 'CONTROL: the server distributed all three levels');
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

  assert.deepEqual(warnings.filter((w) => w.includes('fell back to a client render')), [],
    'no level bailed — a bail at any of them would take the levels below it too');
  assert.equal(host.querySelector('i[slot="x"]'), innermost, 'node identity kept through the whole depth');
  assert.equal(host.querySelector('a1').textContent, 'A-NAMED');
  assert.equal(host.querySelector('b1').textContent, 'B-NAMED');
  assert.equal(host.querySelector('c').textContent, 'C-NAMED');
  assert.equal(host.querySelector('[data-vera-slotted]'), null, 'and every marker is stripped');
  host.remove();
});

/**
 * **The offset/count mark is a NUMBER PAIR parsed out of markup, and markup is not trustworthy.**
 *
 * `data-vera-slotted="offset,count"` is the server's own handoff, but the rescue and the adopt walk
 * read it from whatever is in the page — and a user can paste content carrying that attribute, or
 * a proxy can mangle it. The pair is turned into a range and used to slice a child list, which is
 * exactly the shape that hangs, throws, or quietly captures somebody else's nodes when the numbers
 * are hostile.
 *
 * Companion to the reserved-marker test above: that one covers the attribute on the wrong ELEMENT,
 * this one covers the wrong VALUE. Every case must complete, and none may claim more nodes than
 * the element actually has.
 */
for (const [label, value] of [
  ['a count far beyond the child list', '0,999999'],
  ['a negative offset', '-5,3'],
  ['non-numeric halves', 'abc,def'],
  ['no comma at all', '7'],
  ['an empty value', ''],
  ['an overflowing exponent', '1e400,1e400'],
])
  test(`AUDIT — a hostile slotted mark (${label}) degrades safely`, async () => {
    const host = dom.window.document.createElement('my-host');
    host.innerHTML = `<article><main data-vera-slotted="${value}">USER</main></article>`;
    dom.window.document.getElementById('root').appendChild(host);
    /** Disagrees at the root, so the rescue reads the mark on the way to a clean render. */
    renderInto(html`<section><main><slot>fb</slot></main></section>`, host);
    await settle();
    assert.ok(host.querySelector('section'), 'the render completed rather than throwing');
    assert.equal(host.querySelector('article'), null, 'and the server markup was replaced');
    /** Nothing may be claimed that the element did not contain: one text node at most. */
    assert.ok(slotted(host, '').length <= 1, `claimed ${slotted(host, '').length} nodes from a one-child element`);
    host.remove();
  });

/**
 * **The OFFSET half of `data-vera-slotted="offset,count"`, which nothing exercised.**
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
  const mark = /data-vera-slotted="(\d+),(\d+)"/.exec(serverHtml);
  assert.ok(mark, `the server emitted no slotted mark: ${serverHtml}`);
  assert.notEqual(mark[1], '0', 'CONTROL: this fixture exists to produce a NON-ZERO offset');

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
 * **Serialisation is where node identity dies, and the mark counts nodes.**
 *
 * `data-vera-slotted="offset,count"` addresses the user's content by position among the parent's
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
 * neighbour, which is what makes them worth having as four rather than one.
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
    assert.match(served, /<!---->/, 'CONTROL: the server marked the boundary that would merge');
    assert.equal(served.replace(/<!---*>/g, ''), want, 'CONTROL: and served the right text');

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
 * the `data-vera-slotted` marks — which is why it can save content that carries no `slot`
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
 * **The one shape where content IS lost, and the warning that now says so.** A container holding
 * children that were never server output — no `data-vera-slotted`, no carrier — hands the rescue
 * nothing to prove ownership with: an unnamed `<span>` is structurally indistinguishable from the
 * stale template markup being discarded, so it goes with it. That line is deliberate (the
 * alternative is resurrecting stale server DOM as slot content), but the old message promised "the
 * page is correct" unconditionally, which was false exactly here. The absence of marks is the
 * discriminator, and the message pivots on it: it must name the loss and the fix (client-only
 * containers belong to the plain renderer). Named nodes still survive — a `slot` attribute IS
 * proof of ownership.
 */
test('AUDIT — non-server children: named survive, and the warning names the possible loss', { skip: isProduction }, async () => {
  const host = dom.window.document.createElement('mm-host');
  host.innerHTML = '<h2 slot="header">named</h2><span>plain</span>';
  dom.window.document.getElementById('root').appendChild(host);
  const h2 = host.querySelector('h2');

  const said = [];
  const original = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    renderInto(card(), host);
    await settle();
  } finally {
    console.warn = original;
  }

  assert.equal(host.querySelector('h2'), h2, 'the slot attribute is proof of ownership — the named node survives');
  const warning = said.find((line) => line.includes('fell back'));
  assert.ok(warning, 'the fallback said so');
  assert.match(warning, /carried none of the marks/, 'and named the discriminator');
  assert.match(warning, /cannot be told apart from the stale markup/, 'stated the loss instead of promising correctness');
  assert.match(warning, /renderInto instead/, 'and named the fix');
  host.remove();
});

/** The behavioural half of the test above, valid in BOTH builds: a `slot` attribute is proof of
 *  ownership, so a named node survives the bail even when nothing else can. */
test('AUDIT — non-server children: the named node survives the bail in any build', async () => {
  const host = dom.window.document.createElement('mm-host-prod');
  host.innerHTML = '<h2 slot="header">named</h2>';
  dom.window.document.getElementById('root').appendChild(host);
  const h2 = host.querySelector('h2');
  renderInto(card(), host);
  await settle();
  assert.equal(host.querySelector('h2'), h2, 'same identity, distributed');
  assert.equal(host.querySelector('header').textContent, 'named');
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
