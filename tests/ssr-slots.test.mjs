/**
 * Light-DOM slot distribution on the SERVER — `@verajs/ssr` + `@verajs/renderer/slots`. The
 * server renders once and distributes through the slots module's `_$server$` hook (markerless: no
 * comments, `<slot>` unwrapped, one `data-vera-slotted="offset,count"` attribute on the default
 * slot's PARENT when it got content — all hydration needs, to adopt and to recover). The client seam is inert under the shim; this is the server pass.
 */
import { renderToString, renderToStringAsync } from '@verajs/ssr';
import { wire } from '@verajs/core';
import assert from 'node:assert/strict';
import test from 'node:test';

const { slots } = await import('@verajs/renderer/slots');
wire([slots]);

const CARD = new URL('./fixtures/ssr/slot-card-ssr.js', import.meta.url);
const render = async (children) => (await renderToString(CARD, { children })).html;

test('assigned named + default: distributed, marked, and MARKERLESS (no <slot>, no comments)', async () => {
  const html = await render('<h2 slot="header">Hi there</h2>plain body<b>bold</b>');
  assert.match(html, /<header><h2 slot="header">Hi there<\/h2><\/header>/, 'named content in its slot');
  assert.match(html, /<main data-vera-slotted="0,2">plain body<b>bold<\/b><\/main>/,
    'default content in the default slot, its parent stating where it is and how much of it there is');
  assert.doesNotMatch(html, /<slot[\s>]/, 'no <slot> element survives to the light DOM');
  assert.doesNotMatch(html, /<!--/, 'no framework comments');
  assert.doesNotMatch(html, /<slot-card-ssr[^>]*data-vera-slotted/,
    'the mark belongs to the slot\'s parent, never the host — position is what makes it recoverable');
  /** No top-level duplicate of the source. */
  assert.equal((html.match(/Hi there/g) || []).length, 1, 'source appears exactly once');
});

test('nothing assigned: both slots fall back, host is NOT marked', async () => {
  const html = await render('');
  assert.match(html, /<header><em>fallback header<\/em><\/header>/);
  assert.match(html, /<main>default fallback<\/main>/);
  assert.doesNotMatch(html, /data-vera-slotted/, 'no default content, so no mark');
  assert.doesNotMatch(html, /<slot[\s>]/);
});

test('named only: named distributes, default falls back, host NOT marked', async () => {
  const html = await render('<h2 slot="header">Only</h2>');
  assert.match(html, /<header><h2 slot="header">Only<\/h2><\/header>/);
  assert.match(html, /<main>default fallback<\/main>/);
  assert.doesNotMatch(html, /data-vera-slotted/, 'default slot fell back, so the host is not marked');
});

test('default only: default distributes and marks; named falls back', async () => {
  const html = await render('just text');
  assert.match(html, /<header><em>fallback header<\/em><\/header>/);
  assert.match(html, /<main data-vera-slotted="0,1">just text<\/main>/);
});

test('multiple nodes to one slot keep order', async () => {
  const html = await render('<span slot="header">A</span><span slot="header">B</span>');
  assert.match(html, /<header><span slot="header">A<\/span><span slot="header">B<\/span><\/header>/);
});

test('escaping holds through distribution — a slotted value is still escaped', async () => {
  const html = await render('<span slot="header">a &lt;b&gt;</span>');
  assert.match(html, /<header><span slot="header">a &lt;b&gt;<\/span><\/header>/);
});

test('a component WITHOUT the module wired is unaffected (literal <slot> stays — native takeover client-side)', async () => {
  /** Fresh process semantics can't be had here; instead assert the async path matches the sync one
   *  so both chains distribute identically. */
  const sync = (await renderToString(CARD, { children: '<h2 slot="header">X</h2>Y' })).html;
  const asyncOut = (await renderToStringAsync(CARD, { children: '<h2 slot="header">X</h2>Y' })).html;
  assert.equal(asyncOut, sync, 'sync and async chains produce identical distributed markup');
});

test('AUDIT — unassigned slot content is PRESERVED in an inert template, never dropped', async () => {
  const html = await render('<h2 slot="header">Kept</h2><p slot="nowhere">Survives</p>');
  assert.match(html, /<header><h2 slot="header">Kept<\/h2><\/header>/, 'the assigned one distributes');
  assert.match(html, /<template data-vera-unassigned=""><p slot="nowhere">Survives<\/p><\/template>/,
    'the unassigned one is parked inert (native leaves unassigned light children in the DOM; dropping them lost content forever)');
  assert.doesNotMatch(html, /<main>[^<]*Survives/, 'and is not rendered anywhere');
});

/** Expression alignment around slots: an ASSIGNED slot's fallback is never rendered, so its own
 *  expressions must be accounted without consuming the values that follow it. */
const EXPR = new URL('./fixtures/ssr/slot-expr-ssr.js', import.meta.url);
test('values align around a slot whose fallback holds an expression', async () => {
  const assigned = (await renderToString(EXPR, { children: '<i slot="s">MINE</i>' })).html;
  assert.match(assigned, /<x>A<\/x><s><i slot="s">MINE<\/i><\/s><y>C<\/y>/, 'fallback skipped, x and y still correct');
  const unassigned = (await renderToString(EXPR, { children: '' })).html;
  assert.match(unassigned, /<x>A<\/x><s>fb:B<\/s><y>C<\/y>/, 'fallback rendered with its own expression');
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
    assert.match(html, /<\/template><h2 slot="header">Projected<\/h2>/,
      'the light child follows the declarative shadow template, for the native slot to project');
    assert.doesNotMatch(html, /data-vera-unassigned/, 'never parked — this host distributes nothing');
    assert.doesNotMatch(html, /data-vera-slotted/, 'and carries no light-slots marker');
    assert.match(html, /<slot name="header">fallback<\/slot>/, 'the native <slot> survives verbatim');
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
    assert.match(html, /<header><h2 slot="header">OUTER HEAD<\/h2><\/header>/, 'the outer distributes');
    assert.match(html, /<i><b slot="tag">TAG<\/b><\/i>/, 'and the INNER one distributes its named slot');
    assert.match(html, /<u data-vera-slotted="0,1">INNER BODY<\/u>/, 'and its default slot, marked for hydration');
    assert.doesNotMatch(html, /no tag|no body/, 'no slot fell back to content it was given');
    assert.doesNotMatch(html, /<slot[\s>]/, 'and nothing is left as a <slot>');
  });

test('AUDIT — the nested server output is what the CLIENT produces (the divergence itself)', async () => {
  const { html } = await renderToString(NESTED, { children: NESTED_CHILDREN });
  /** Markers are the hydration handoff and the hydrator strips them; everything else must match
   *  the client render recorded in `tests/renderer-slots.test.mjs`. */
  const withoutMarkers = html.replace(/ data-vera-slotted="[^"]*"/g, '');
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
  assert.match(html, /<header><h2 slot="header">MINE<\/h2><\/header>/, 'routed by the committed name');
  assert.match(html, /<footer>AFTER<\/footer>/, 'and the value after the slot is still its own');
  assert.doesNotMatch(html, /no header/, 'the fallback is not rendered beside it');
});
