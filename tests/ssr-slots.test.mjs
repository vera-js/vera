/**
 * Light-DOM slot distribution on the SERVER — `@verajs/ssr` distributes while `@verajs/renderer/slots` is
 * wired (its `'slot'` insert is the marker; the distributor is ssr's own). A filled `<slot>` steps out between the
 * client's own region markers (`<!--[-->` … `<!--]-->`); one with nothing assigned stays showing its fallback, as on the
 * client. What hydration needs and the DOM cannot say is STATED on the host: `data-vm-light="FORMAT:runs"` — the format
 * number, then for each light child in light order the index of the range it sits in, run-length encoded, the last
 * index being the unassigned carrier. The client seam is inert under the shim; this is the server pass.
 *
 * Placement is asserted on the markup with the marks removed (`bare`), and the marks themselves
 * where a test is about them — so a format change moves the mark tests and nothing else.
 */
import { renderToString, renderToStringAsync } from '@verajs/ssr';
import { wire } from '@verajs/core';
import assert from 'node:assert/strict';
import test from 'node:test';

const { slots } = await import('@verajs/renderer/slots');
wire([slots]);

const CARD = new URL('./fixtures/ssr/slot-card-ssr.js', import.meta.url);
const render = async (children) => (await renderToString(CARD, { children })).html;
/** The content, without the framework's marks: the host's light-tree statement and each filled slot's two region markers. */
const bare = (html) => html.replace(/ data-vm-light="[^"]*"/g, '').replace(/<!--[[\]]-->/g, '');

test('assigned named + default: distributed, and each filled slot bounded by the client\'s own region markers', async () => {
  const html = await render('<h2 slot="header">Hi there</h2>plain body<b>bold</b>');
  assert.match(bare(html), /<header><h2 slot="header">Hi there<\/h2><\/header>/, 'named content in its slot');
  assert.match(html, /<header><!--\[--><h2 slot="header">Hi there<\/h2><!--\]--><\/header>/, 'the named slot\'s region, as the client leaves it');
  assert.match(html, /<slot-card-ssr data-vm-light="1:0,1\*2">/,
    'and the host states the light tree: one child in range 0, then two in range 1');
  assert.match(html, /<main><!--\[-->plain body<b>bold<\/b><!--\]--><\/main>/,
    'default content in the default slot, between its region markers');
  assert.doesNotMatch(bare(html), /<slot[\s>]/, 'no <slot> element survives to the light DOM');
  assert.doesNotMatch(bare(html), /<!--/, 'no comments but the two markers of each filled slot');
  assert.equal((html.match(/<!--\[-->/g) ?? []).length, 2, 'one region start per filled slot');
  assert.equal((html.match(/<!--\]-->/g) ?? []).length, 2, 'one region end per filled slot');
  assert.doesNotMatch(html, /data-vm-slotted/, 'no position attributes: the markers are the positions');
  /** No top-level duplicate of the source. */
  assert.equal((html.match(/Hi there/g) || []).length, 1, 'source appears exactly once');
});

test('nothing assigned: both slots fall back, no range is marked', async () => {
  const html = await render('');
  assert.match(bare(html), /<header><slot name="header"><em>fallback header<\/em><\/slot><\/header>/);
  assert.match(bare(html), /<main><slot>default fallback<\/slot><\/main>/);
  assert.doesNotMatch(html, /<!--/, 'nothing distributed, so no region is marked');
  assert.match(html, /<slot-card-ssr data-vm-light="1:">/, 'and the host states an empty light tree');
  /** A slot with nothing assigned stays in the page, showing its fallback (Brian, 2026-10-02) — both do here. */
  assert.equal((bare(html).match(/<slot[\s>]/g) ?? []).length, 2, 'both fallback slots stay');
});

test('named only: named distributes and is marked, default falls back unmarked', async () => {
  const html = await render('<h2 slot="header">Only</h2>');
  assert.match(bare(html), /<header><h2 slot="header">Only<\/h2><\/header>/);
  assert.match(bare(html), /<main><slot>default fallback<\/slot><\/main>/);
  assert.match(html, /<header><!--\[--><h2 slot="header">Only<\/h2><!--\]--><\/header>/, 'the named slot\'s region is marked');
  assert.match(html, /<main><slot>default fallback/, 'the fallen-back one states nothing');
  assert.match(html, /<slot-card-ssr data-vm-light="1:0">/, 'the one light child sits in range 0');
});

test('default only: default distributes and marks; named falls back', async () => {
  const html = await render('just text');
  assert.match(bare(html), /<header><slot name="header"><em>fallback header<\/em><\/slot><\/header>/);
  assert.match(html, /<main><!--\[-->just text<!--\]--><\/main>/);
});

test('multiple nodes to one slot keep order', async () => {
  const html = await render('<span slot="header">A</span><span slot="header">B</span>');
  assert.match(bare(html), /<header><span slot="header">A<\/span><span slot="header">B<\/span><\/header>/);
});

test('escaping holds through distribution — a slotted value is still escaped', async () => {
  const html = await render('<span slot="header">a &lt;b&gt;</span>');
  assert.match(bare(html), /<header><span slot="header">a &lt;b&gt;<\/span><\/header>/);
});

test('a component WITHOUT the module wired is unaffected (literal <slot> stays — native takeover client-side)', async () => {
  /** Fresh process semantics can't be had here; instead assert the async path matches the sync one
   *  so both chains distribute identically. */
  const sync = (await renderToString(CARD, { children: '<h2 slot="header">X</h2>Y' })).html;
  const asyncOut = (await renderToStringAsync(CARD, { children: '<h2 slot="header">X</h2>Y' })).html;
  assert.equal(asyncOut, sync, 'sync and async chains produce identical distributed markup');
});

test('AUDIT — unassigned slot content is PRESERVED in the hidden container, never dropped', async () => {
  const html = await render('<h2 slot="header">Kept</h2><p slot="nowhere">Survives</p>');
  assert.match(bare(html), /<header><h2 slot="header">Kept<\/h2><\/header>/, 'the assigned one distributes');
  assert.match(html, /<[\w-]+-ssr[^>]*><vm-unassigned hidden=""><p slot="nowhere">Survives<\/p><\/vm-unassigned>/,
    'the unassigned one waits in the host\'s first child, as the client keeps it (native leaves unassigned light children in the DOM; dropping them lost content forever)');
  assert.doesNotMatch(bare(html), /<main>[^<]*Survives/, 'and is not rendered anywhere');
});

/** Expression alignment around slots: an ASSIGNED slot's fallback is never rendered, so its own
 *  expressions must be accounted without consuming the values that follow it. */
const EXPR = new URL('./fixtures/ssr/slot-expr-ssr.js', import.meta.url);
test('values align around a slot whose fallback holds an expression', async () => {
  const assigned = (await renderToString(EXPR, { children: '<i slot="s">MINE</i>' })).html;
  assert.match(bare(assigned), /<x>A<\/x><s><i slot="s">MINE<\/i><\/s><y>C<\/y>/, 'fallback skipped, x and y still correct');
  const unassigned = (await renderToString(EXPR, { children: '' })).html;
  assert.match(bare(unassigned), /<x>A<\/x><s><slot name="s">fb:B<\/slot><\/s><y>C<\/y>/, 'fallback rendered with its own expression');
});

/**
 * **A SHADOW component must be untouched by the light-slots pass.** The server lifts a host's
 * children out before the lifecycle so the light path can distribute them; a shadow host's
 * children are its LIGHT DOM, which the platform projects through the native `<slot>` itself, so
 * they have to go back exactly as they were. When they did not, wiring slots for the light
 * components in an app silently broke every shadow component with slotted content — the sync
 * chain dropped it from the page and the async chain buried it in the unassigned carrier, which
 * is the very regression the light-DOM serialization in `renderInstance` exists to prevent.
 */
const SHADOW = new URL('./fixtures/ssr/slot-shadow-ssr.js', import.meta.url);
for (const [name, renderer] of [
  ['sync', renderToString],
  ['async', renderToStringAsync],
])
  test(`AUDIT — a SHADOW component keeps its light children with slots wired (${name})`, async () => {
    const { html } = await renderer(SHADOW, { children: '<h2 slot="header">Projected</h2>' });
    assert.match(bare(html), /<\/template><h2 slot="header">Projected<\/h2>/,
      'the light child follows the declarative shadow template, for the native slot to project');
    assert.doesNotMatch(html, /data-vm-unassigned/, 'never parked — this host distributes nothing');
    assert.doesNotMatch(html, /<!--[[\]]-->|data-vm-light="./, 'and carries no light-slots marker');
    assert.match(bare(html), /<slot name="header">fallback<\/slot>/, 'the native <slot> survives verbatim');
  });

/**
 * **NESTING — a light-slot component slotted inside another.** Each host distributes only its own
 * direct children, so this has to compose with no special handling; it did not. The scanner used
 * to emit a nested component's rendered markup and then walk its children as ordinary markup
 * *after* it, so the inner component never received the content it was supposed to distribute:
 * every slot rendered its fallback and the user's markup sat after the template. The client
 * distributes it correctly, which made this a server/client divergence — the worst class this
 * package has — with a visibly wrong first paint and a hydration mismatch behind it.
 */
const NESTED = new URL('./fixtures/ssr/slot-nested-ssr.js', import.meta.url);
const NESTED_CHILDREN =
  '<h2 slot="header">OUTER HEAD</h2><slot-inner-ssr><b slot="tag">TAG</b>INNER BODY</slot-inner-ssr>';
for (const [name, renderer] of [
  ['sync', renderToString],
  ['async', renderToStringAsync],
])
  test(`AUDIT — a nested light-slot component distributes too (${name})`, async () => {
    const { html } = await renderer(NESTED, { children: NESTED_CHILDREN });
    assert.match(bare(html), /<header><h2 slot="header">OUTER HEAD<\/h2><\/header>/, 'the outer distributes');
    assert.match(bare(html), /<i><b slot="tag">TAG<\/b><\/i>/, 'and the INNER one distributes its named slot');
    assert.match(html, /<u><!--\[-->INNER BODY<!--\]--><\/u>/, 'and its default slot, between its region markers');
    assert.doesNotMatch(bare(html), /no tag|no body/, 'no slot fell back to content it was given');
    assert.doesNotMatch(bare(html), /<slot[\s>]/, 'and nothing is left as a <slot>');
  });

test('AUDIT — the nested server output is what the CLIENT produces (the divergence itself)', async () => {
  const { html } = await renderToString(NESTED, { children: NESTED_CHILDREN });
  /** Markers are the hydration handoff and the hydrator strips them; everything else must match
   *  the client render recorded in `tests/renderer-slots.test.mjs`. */
  const withoutMarkers = bare(html);
  assert.equal(
    withoutMarkers,
    '<slot-outer-ssr><article><header><h2 slot="header">OUTER HEAD</h2></header>' +
      '<main><slot-inner-ssr><i><b slot="tag">TAG</b></i><u>INNER BODY</u></slot-inner-ssr></main>' +
      '</article></slot-outer-ssr>'
  );
});

/**
 * **A `<slot>`'s own bindings are part of its meaning.** `<slot name=${section}>` has no name in
 * the static markup, and the server used to read the markup — so the slot was treated as an
 * unnamed one, took the default content, and left the real default slot on its fallback.
 */
const BOUND = new URL('./fixtures/ssr/slot-bound-ssr.js', import.meta.url);
test('AUDIT — a DYNAMIC slot name distributes by the name it actually has', async () => {
  const { html } = await renderToString(BOUND, { children: '<h2 slot="header">MINE</h2>' });
  assert.match(bare(html), /<header><h2 slot="header">MINE<\/h2><\/header>/, 'routed by the committed name');
  assert.match(bare(html), /<footer>AFTER<\/footer>/, 'and the value after the slot is still its own');
  assert.doesNotMatch(bare(html), /no header/, 'the fallback is not rendered beside it');
});

/**
 * **Three levels of composition, not merely nesting** — each component slots the next, so every
 * host is simultaneously somebody's slotted content and somebody else's host. The middle one is
 * the interesting position: it arrives as an assigned node of the outer default slot AND has to
 * distribute its own children. The outermost is `async`, so this also holds the awaited chain to
 * the same answer as the synchronous one.
 */
const DEEP = new URL('./fixtures/ssr/slot-deep-ssr.js', import.meta.url);
test('AUDIT — light slots compose three levels deep, through the async chain', async () => {
  const { html } = await renderToStringAsync(DEEP, {
    children:
      '<i slot="x">A-NAMED</i>' +
      '<deep-b slot=""><i slot="x">B-NAMED</i><deep-c><i slot="x">C-NAMED</i></deep-c></deep-b>',
  });
  assert.match(bare(html), /<a1><i slot="x">A-NAMED<\/i><\/a1>/, 'the outermost distributes its named slot');
  assert.match(html, /<a2><!--\[--><deep-b/, 'and its default slot took the middle component');
  assert.match(bare(html), /<b1><i slot="x">B-NAMED<\/i><\/b1>/, 'the middle one distributes while BEING distributed');
  assert.match(html, /<b2><!--\[--><deep-c/, 'and passes the innermost along');
  assert.match(bare(html), /<c><i slot="x">C-NAMED<\/i><\/c>/, 'the innermost distributes too');
  assert.doesNotMatch(bare(html), /no-a\b|no-b\b|no-c\b/, 'no level fell back to content it was given');
  assert.doesNotMatch(bare(html), /<slot[\s>]/, 'and nothing is left as a <slot>');
});

/**
 * **A `<template>` in a component's own markup used to cost it the whole server render.**
 *
 * `@verajs/ssr`'s DOM parses markup to answer `querySelector`, and it REFUSED any fragment
 * containing a `<template>` — a template's content is a separate fragment it does not model, and
 * the rule there is to decline rather than guess at a tree. A declined parse leaves the markup a
 * string with no nodes, so every query answered emptily: measured against a real DOM, ONE empty
 * `<template>` turned `querySelectorAll('*')` from three elements into none.
 *
 * `@verajs/renderer/slots` finds slot positions with a query, so such a component distributed on
 * the client and silently did not on the server — a server/client divergence, from markup nobody
 * would suspect. The parser now keeps a template's interior opaque instead, exactly as it already
 * did for `<svg>`, which is also the honest answer: a real DOM does not match template content from
 * the host either, so on the question a selector asks, the two agree.
 */
const TEMPLATED = new URL('./fixtures/ssr/slot-template-ssr.js', import.meta.url);
test('AUDIT — a component whose markup holds a <template> still distributes on the server', async () => {
  const { html } = await renderToString(TEMPLATED, { children: '<b slot="h">MINE</b>' });

  assert.match(bare(html), /<p><b slot="h">MINE<\/b>/, 'the real slot distributed');
  assert.doesNotMatch(bare(html), /<slot name="h">fallback<\/slot>/, 'so it is not showing its fallback');
  assert.match(bare(html), /<template><i>inert<\/i><\/template>/,
    'and the template is reproduced byte for byte, its interior untouched');
});

test('AUDIT — a component the server CAN parse says nothing', async () => {
  const said = [];
  const original = console.warn;
  console.warn = (message) => said.push(String(message));
  try {
    await renderToString(CARD, { children: '<h2 slot="header">Hi</h2>body' });
  } finally {
    console.warn = original;
  }
  assert.deepEqual(said.filter((message) => message.includes('the server cannot see')), [],
    'the diagnostic must not fire for a component that distributed perfectly well');
});

/**
 * **A `<template>` as slotted CONTENT.** The same parse refusal that cost a component its whole
 * node view also stopped this working: children containing a `<template>` could not be parsed, so
 * the snapshot was empty and nothing distributed. Keeping a template's interior opaque fixed both
 * symptoms at once, which is worth pinning separately — they looked like two defects.
 */
test('AUDIT — a <template> among the children distributes like any other node', async () => {
  const slotted = await renderToString(CARD, {
    children: '<template slot="header"><b>inert</b></template>plain body',
  });
  assert.match(bare(slotted.html), /<header><template slot="header"><b>inert<\/b><\/template><\/header>/,
    'a template assigned to a named slot lands there, its interior untouched');

  const mixed = await renderToString(CARD, {
    children: '<h2 slot="header">H</h2><template><b>x</b></template>tail',
  });
  assert.match(bare(mixed.html), /<header><h2 slot="header">H<\/h2><\/header>/, 'the named slot still works beside it');
  assert.match(mixed.html, /<main><!--\[--><template><b>x<\/b><\/template>tail<!--\]--><\/main>/,
    'and a template in the default slot is counted and placed like any other node');
});

/**
 * **Two text light children never meet in one range** (2026-10-08): `t1` and `t2` belong to the default slot with a named
 * child between them in LIGHT order, so the server writes them side by side in the default range — where the browser's
 * parser merged them into one node while the statement counts two, and hydration fell back. An empty comment goes
 * between them; a range's comments are never light content, so hydration needs no rule for it.
 */
test('interleaved text: the default range keeps its two text children apart, so the browser parses two nodes', async () => {
  const html = await render('<b slot="header">H1</b>t1<b slot="header">H2</b>t2');
  assert.match(html, /<main><!--\[-->t1<!---->t2<!--\]--><\/main>/, 'an empty comment between the two texts');
  assert.match(html, /data-vm-light="1:0,1,0,1"/, 'and the statement counts both, in light order');
  const { JSDOM } = await import('jsdom');
  const parsed = new JSDOM(html).window.document.querySelector('main');
  assert.deepEqual([...parsed.childNodes].filter((node) => node.nodeType === 3).map((node) => node.data), ['t1', 't2'], 'two text nodes, as the statement counts');
});

test('CONTROL: text beside an element in a range needs no separator', async () => {
  const html = await render('plain body<b>bold</b>');
  assert.match(html, /<main><!--\[-->plain body<b>bold<\/b><!--\]--><\/main>/);
});

test('the unassigned carrier keeps two text children apart too', async () => {
  const html = (await renderToString(new URL('./fixtures/ssr/slot-named-only-ssr.js', import.meta.url), { children: 't1<b slot="h">H</b>t2' })).html;
  assert.match(html, /<vm-unassigned hidden="">t1<!---->t2<\/vm-unassigned>/, 'an empty comment between the two texts in the carrier');
  const { JSDOM } = await import('jsdom');
  const carrier = new JSDOM(html).window.document.querySelector('vm-unassigned');
  assert.deepEqual([...carrier.childNodes].filter((node) => node.nodeType === 3).map((node) => node.data), ['t1', 't2'], 'two text nodes, as the statement counts');
});
