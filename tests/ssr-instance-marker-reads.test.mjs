/**
 * **The render's instance marker is never visible to code reading the DOM** (2026-11-23). A child a component builds
 * and hands a property to carries the render's per-process marker until it renders, and it was a real attribute:
 * `getAttributeNames()`, `attributes` (its length, items and named access), `hasAttributes()`, `isEqualNode`, a
 * parent's `innerHTML`, the child's own `outerHTML` and a deep clone's reads all showed it or answered by it, so a
 * component that wrote what it read (a show-source or debug component) served the marker's secret name in the page.
 * Pinned through a real render: each read, exactly as a browser's element answers it (it has no such attribute).
 * Reads keyed by the marker's own name (`getAttribute`, `hasAttribute`, a selector naming it) need the secret first.
 * CONTROL: the marker still does its job, the child renders as the instance it was given (`a,b`), and a child given
 * nothing renders from its own defaults (`none`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr';

const PAGE = new URL('./fixtures/ssr/marker-reads-ssr.js', import.meta.url);

test("a pending child's marker is not in any DOM read, and the child still renders as the instance it was given", async () => {
  const { html } = await renderToString(PAGE, { tag: 'marker-reads-ssr' });
  assert.equal(html.includes('vera-ssr-'), false, 'no marker anywhere in the page');
  const text = (name) => html.match(new RegExp(`<p class="${name}">([^<]*)</p>`))?.[1];
  assert.equal(text('names'), 'data-x');
  const tag = '&#60;marker-kid-ssr data-x=&#34;1&#34;&#62;&#60;/marker-kid-ssr&#62;';
  assert.equal(text('inner'), tag);
  assert.equal(text('outer'), tag);
  assert.equal(text('has'), 'true 1 false 0');
  assert.equal(text('more'), '1 data-x 1 true data-x false', 'length, item, named access, equality with a twin, a clone\'s names and markup');
  assert.match(html, /<div><marker-kid-ssr data-x="1"><template shadowrootmode="open"><i>a,b<\/i><\/template><\/marker-kid-ssr><\/div>/);
  assert.match(html, /<div><marker-kid-ssr><template shadowrootmode="open"><i>none<\/i><\/template><\/marker-kid-ssr><\/div>/);
});
