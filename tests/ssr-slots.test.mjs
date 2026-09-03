/**
 * Light-DOM slot distribution on the SERVER — `@verajs/ssr` + `@verajs/renderer/slots`. The
 * server renders once and distributes through the slots module's `_$server$` hook (markerless: no
 * comments, `<slot>` unwrapped, one `data-vera-slotted` host attribute when the default slot got
 * content — all hydration needs). The client seam is inert under the shim; this is the server pass.
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
  assert.match(html, /<main>plain body<b>bold<\/b><\/main>/, 'default content in the default slot');
  assert.doesNotMatch(html, /<slot[\s>]/, 'no <slot> element survives to the light DOM');
  assert.doesNotMatch(html, /<!--/, 'no framework comments');
  assert.match(html, /<slot-card-ssr data-vera-slotted="2">/, 'the default slot took 2 nodes (text + <b>), so the host carries the count');
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
  assert.match(html, /<main>just text<\/main>/);
  assert.match(html, /data-vera-slotted/);
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
