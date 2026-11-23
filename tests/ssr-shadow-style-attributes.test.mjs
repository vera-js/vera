/**
 * **A `<style>` appended straight to a shadow root is served with its attributes** (2026-11-23). The server DOM keeps a
 * root's own styles as its stylesheets and serves them first, and it kept only their text: `media="print"` was dropped,
 * so print-only CSS applied on screen, and `nonce` too, so a nonce-based Content-Security-Policy blocked the style.
 * Pinned through a real render: each served `<style>` exactly, in order, a style with none still bare, and an
 * attribute escaped as every attribute is. CONTROL: the same style one level down (in a `<div>`), which is content and
 * has always kept them, and one event-handler attribute at both doors, which must serve it the same way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr';

const PAGE = new URL('./fixtures/ssr/shadow-style-attributes-ssr.js', import.meta.url);

test("a shadow root's own <style> is served with its attributes, in order, and a bare one stays bare", async () => {
  const { html } = await renderToString(PAGE, { tag: 'shadow-style-attributes-ssr' });
  const styles = html.match(/<style\b[^>]*>[^<]*<\/style>/g) ?? [];
  assert.deepEqual(styles, [
    '<style data-vm-sheet="styles">.plain{color:green}</style>',
    '<style data-vm-sheet="styles" media="print" nonce="abc123">p{color:red}</style>',
    '<style data-vm-sheet="styles">.after{color:gray}</style>',
    '<style data-vm-sheet="styles" title="a &#34;b&#34; &#38; c">.quoted{color:navy}</style>',
    '<style data-vm-sheet="styles" media="screen">.marked{color:teal}</style>',
    '<style data-vm-sheet="styles" onload="go(&#34;x&#34;)">.handler{color:olive}</style>',
    '<style media="print" nonce="abc123">p{color:blue}</style>',
    '<style onload="go(&#34;x&#34;)">.handler{color:olive}</style>',
  ]);
});

test('one attribute rule at both doors: the sheet serves an attribute exactly as the same style held in a <div> does', async () => {
  const { html } = await renderToString(PAGE, { tag: 'shadow-style-attributes-ssr' });
  const handlers = html.match(/<style\b[^>]*>\.handler\{color:olive\}<\/style>/g) ?? [];
  assert.equal(handlers.length, 2);
  const [sheet, held] = handlers.map((tag) => tag.slice(0, tag.indexOf('>')));
  assert.equal(sheet, `<style data-vm-sheet="styles"${held.slice('<style'.length)}`);
});

test('a root with an attributed sheet and an adopted one serves the same tags, in the same order, as one without the attribute', async () => {
  const tags = (html) => html.match(/<style\b[^>]*>[^<]*<\/style>/g) ?? [];
  const attributed = tags((await renderToString(PAGE, { tag: 'shadow-style-attributed-adopted-ssr' })).html);
  const bare = tags((await renderToString(PAGE, { tag: 'shadow-style-bare-adopted-ssr' })).html);
  assert.deepEqual(bare, [
    '<style data-vm-sheet="styles">.first{color:green}</style>',
    '<style data-vm-sheet="styles">.middle{color:red}</style>',
    '<style data-vm-sheet="styles">.last{color:gray}</style>',
    '<style data-vm-sheet="styles">.adopted{color:purple}</style>',
  ]);
  assert.deepEqual(attributed, bare.map((tag) => (tag.includes('.middle') ? tag.replace('"styles">', '"styles" media="print">') : tag)));
});
