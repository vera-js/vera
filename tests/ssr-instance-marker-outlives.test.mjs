/**
 * **No node or string keeps the render's instance marker visible past that render** (2026-11-24, 2026-11-25). The DOM
 * reads hid the marker only while an instance was pending, and a marked node or marked markup that outlived its render
 * broke that: a deep clone taken after the append that marked its source, a child appended, removed and never rendered,
 * a deep clone of markup holding a child a template's property binding marked, and a light component whose own children
 * are that marked markup (kept as a deep clone and as itself), all kept in a module cache, showed the per-process name
 * to a later render through `getAttributeNames()`, `attributes`, `outerHTML`, `innerHTML` and a textarea holding that
 * markup, all of which reached the page; `hasAttributes()` answered true and `isEqualNode` false for a bare tag. Pinned
 * through real renders: every read leaves the marker out wherever it sits, and a copy never carries it. CONTROL: the
 * append did mark the removed child, the binding the bound one, and in the production build the light host's children
 * are marked text and the kid parsed from its kept clone carries the marker (read off the shim's own record), so there
 * was a name to leak; the development build holds those children as nodes, which the copy rule already covers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString, serializeTemplate } from '@verajs/ssr';
import { html as template } from '@verajs/core';
import { isProduction } from './dist.mjs';

const PAGE = new URL('./fixtures/ssr/marker-outlives-ssr.js', import.meta.url);

test('a clone, a removed child, a clone of bound markup and a light host (cloned and itself) kept past their render show no marker to a later render', async () => {
  const first = await renderToString(PAGE, { tag: 'outlives-keeper-ssr' });
  assert.equal(globalThis.__markerOutlives.marked, true, 'CONTROL: the append marked the child');
  assert.equal(first.html.includes('vera-ssr-'), false);
  const bound = await renderToString(PAGE, { tag: 'outlives-bound-ssr' });
  assert.equal(globalThis.__markerOutlives.boundMarked, true, 'CONTROL: the binding marked the child');
  assert.match(bound.html, /<outlives-kid-ssr><template shadowrootmode="open"><i>d<\/i>/, 'CONTROL: the bound child rendered as its instance');
  const light = await renderToString(PAGE, { tag: 'outlives-light-ssr' });
  const { lightForm } = globalThis.__markerOutlives;
  assert.equal(lightForm === 'text' || lightForm === 'node', true, `CONTROL: the light host's children are text or nodes (${lightForm})`);
  if (isProduction) assert.equal(lightForm, 'text', 'CONTROL: production holds the light host\'s children as marked text');
  assert.match(light.html, /<outlives-kid-ssr><template shadowrootmode="open"><i>e<\/i>/, 'CONTROL: the light host\'s child rendered as its instance');
  const { html } = await renderToString(PAGE, { tag: 'outlives-reader-ssr' });
  assert.equal(html.includes('vera-ssr-'), false, 'no marker anywhere in the later page');
  const text = (name) => html.match(new RegExp(`<p class="${name}">([^<]*)</p>`))?.[1];
  assert.equal(text('clone'), '|&#60;outlives-kid-ssr&#62;&#60;/outlives-kid-ssr&#62;', 'the clone: no names, plain markup');
  assert.equal(text('gone'), '|&#60;outlives-kid-ssr&#62;&#60;/outlives-kid-ssr&#62;', 'the removed child: no names, plain markup');
  assert.equal(text('light-clone'), '&#60;span&#62;&#60;outlives-kid-ssr&#62;&#60;/outlives-kid-ssr&#62;&#60;/span&#62;', 'the light host\'s clone: plain markup');
  assert.equal(text('light'), '&#60;span&#62;&#60;outlives-kid-ssr&#62;&#60;/outlives-kid-ssr&#62;&#60;/span&#62;', 'the light host itself: plain markup');
  assert.equal(globalThis.__markerOutlives.parsedMarked, false, 'the kid parsed from the kept clone carries no marker: the render that stamped it took it off');
  assert.equal(text('reads'), '0|||false|true', 'attributes, their names, getAttributeNames(), hasAttributes() and isEqualNode answer as for a bare tag');
  assert.equal(text('bound'), 'class|&#60;div class=&#34;w&#34;&#62;&#60;outlives-kid-ssr&#62;&#60;/outlives-kid-ssr&#62;&#60;/div&#62;', 'the bound clone: plain markup');
});

test('a copy of a prepared child placed before it is a fresh instance, and the prepared one renders once, in its own place', async () => {
  const { html } = await renderToString(PAGE, { tag: 'outlives-twin-ssr' });
  assert.equal(globalThis.__markerOutlives.twinMarked, true, 'CONTROL: the append marked the child the copy is taken from');
  const kids = [...html.matchAll(/<div class="(copy|original)"><outlives-kid-ssr><template shadowrootmode="open"><i>([^<]*)<\/i>/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(kids, ['copy:none', 'original:t'], 'the copy is built from its tag; the prepared instance keeps its rows, in its place');
});

test('a prepared child one render kept and a later render placed does not serve the earlier request\'s data', async () => {
  await renderToString(PAGE, { tag: 'outlives-request-one-ssr' });
  assert.equal(globalThis.__markerOutlives.holderMarked, true, 'CONTROL: the append marked the kept child');
  const { html } = await renderToString(PAGE, { tag: 'outlives-request-two-ssr' });
  assert.equal(html.includes('request-one-secret'), false, 'no data of the earlier request in the later page');
  assert.match(html, /<outlives-kid-ssr><template shadowrootmode="open"><i>none<\/i>/, 'the kept child renders as a fresh instance');
});

/** Every marker a kept object holds in its own record: attribute names, stored markup, raw text, source open tags. */
const markersIn = (node, seen = new Set()) => {
  if (node === null || typeof node !== 'object' || seen.has(node)) return 0;
  seen.add(node);
  let found = 0;
  for (const name of node._attributes?.keys() ?? []) if (name.startsWith('vera-ssr-')) found++;
  for (const text of [node._raw, node._sourceOpenTag]) if (typeof text === 'string' && text.includes('vera-ssr-')) found++;
  for (const entry of node._entries ?? []) found += typeof entry === 'string' ? Number(entry.includes('vera-ssr-')) : markersIn(entry, seen);
  if (node._content) found += markersIn(node._content, seen);
  return found;
};

test('after the render that stamped them, nothing a component kept holds a marker in its own record', async () => {
  await renderToString(PAGE, { tag: 'outlives-mover-ssr' });
  await renderToString(PAGE, { tag: 'outlives-shadow-mover-ssr' });
  const kept = globalThis.__markerOutlives;
  if (isProduction) assert.equal(kept.detachedMarked, true, 'CONTROL: production\'s parsed kid carried the marker when detached');
  if (isProduction) assert.equal(kept.shadowMovedMarked, true, 'CONTROL: production\'s moved shadow content carried the marker as text');
  const holders = ['clone', 'gone', 'bound', 'lightClone', 'light', 'holder', 'detached', 'box', 'shadowBox'];
  for (const name of holders) assert.ok(kept[name], `CONTROL: the fixture kept ${name}`);
  for (const name of holders) assert.equal(markersIn(kept[name]), 0, `${name} holds no marker after its render`);
  const { html } = await renderToString(PAGE, { tag: 'outlives-request-two-ssr' });
  assert.equal(html.includes('vera-ssr-'), false, 'CONTROL render: no marker in a later page');
  assert.equal(kept.box.innerHTML, '<span></span><b><outlives-kid-ssr></outlives-kid-ssr></b>', 'the moved children read back as plain markup');
  assert.equal(kept.detached.outerHTML, '<outlives-kid-ssr></outlives-kid-ssr>', 'the detached kid reads back as a bare tag');
  assert.equal(kept.shadowBox.innerHTML, '<p><outlives-kid-ssr></outlives-kid-ssr></p>', 'the moved shadow content reads back as plain markup');
});

test('serializeTemplate on its own writes no instance marker, and still delivers nothing it cannot', async () => {
  await renderToString(PAGE, { tag: 'outlives-twin-ssr' });
  const markup = serializeTemplate(template`<div><outlives-kid-ssr .rows=${['alone']}></outlives-kid-ssr></div>`);
  assert.equal(markup, '<div><outlives-kid-ssr></outlives-kid-ssr></div>', 'the flattener\'s output: the tag, no per-process name');
  const { html: page } = await renderToString(PAGE, { tag: 'outlives-request-two-ssr' });
  assert.equal(page.includes('alone'), false, 'CONTROL render: the released instance is never rendered with its rows');
});

test('in the render that stamped it, after the pickup, a sibling reading the host and its parsed kid sees no marker', async () => {
  const { html } = await renderToString(PAGE, { tag: 'outlives-same-render-ssr' });
  if (isProduction) assert.equal(globalThis.__markerOutlives.peekMarked, true, 'CONTROL: production\'s parsed kid carries the marker while it is read');
  assert.equal(html.includes('vera-ssr-'), false, 'no marker anywhere in the page');
  const peek = html.match(/<p class="peek">([^<]*)<\/p>/)?.[1];
  assert.equal(peek, '||false|true|&#60;span&#62;&#60;outlives-kid-ssr&#62;&#60;/outlives-kid-ssr&#62;&#60;/span&#62;|&#60;outlives-kid-ssr&#62;&#60;/outlives-kid-ssr&#62;', 'every read answers as for a bare tag');
});

test('the public serializeTemplate called inside a render returns the tag unstamped, and the page holds no marker', async () => {
  const { html } = await renderToString(PAGE, { tag: 'outlives-flatten-ssr' });
  assert.equal(globalThis.__markerOutlives.flat, '<outlives-kid-ssr></outlives-kid-ssr>', 'the flattener\'s output inside a render');
  assert.match(html, /<p class="flat">&#60;outlives-kid-ssr&#62;&#60;\/outlives-kid-ssr&#62;<\/p>/, 'CONTROL: the component rendered what it flattened');
  assert.equal(html.includes('vera-ssr-'), false, 'no marker anywhere in the page');
});

test('markup the serializer stamped into a template through the render insert leaves no marker in the template, its copies or its content', async () => {
  const { html } = await renderToString(PAGE, { tag: 'outlives-template-ssr' });
  const kept = globalThis.__markerOutlives;
  assert.equal(kept.templateMarked, true, 'CONTROL: the template\'s raw text held the marker');
  assert.equal(html.includes('vera-ssr-'), false, 'no marker anywhere in the page');
  for (const name of ['template', 'rawClone', 'content', 'contentClone']) assert.equal(markersIn(kept[name]), 0, `${name} holds no marker after its render`);
  const plain = '<b><outlives-kid-ssr></outlives-kid-ssr></b>';
  assert.equal(kept.template.innerHTML, plain, 'the template reads back as plain markup');
  assert.equal(kept.rawClone.innerHTML, plain, 'its clone of the raw text reads back as plain markup');
  assert.equal(kept.contentClone.querySelector('outlives-kid-ssr').getAttributeNames().length, 0, 'the kid parsed from the content clone has no attribute');
});

test('a stamp a timer makes between renders is hidden from every read until the next render strips it', async () => {
  await renderToString(PAGE, { tag: 'outlives-late-ssr' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const kept = globalThis.__markerOutlives;
  assert.equal(kept.lateMarked, true, 'CONTROL: the append after the render stamped the kid');
  assert.equal(kept.lateBox.innerHTML, '<outlives-kid-ssr></outlives-kid-ssr>', 'between renders the box reads back as plain markup');
  assert.equal(kept.late.outerHTML, '<outlives-kid-ssr></outlives-kid-ssr>', 'between renders the kid reads back as a bare tag');
  assert.equal(kept.late.getAttributeNames().length, 0, 'between renders the kid lists no attribute');
  const { html } = await renderToString(PAGE, { tag: 'outlives-request-two-ssr' });
  assert.equal(html.includes('vera-ssr-'), false, 'no marker anywhere in the next page');
  assert.equal(markersIn(kept.lateBox), 0, 'the next render stripped the stamp it found');
});

test('an instance whose attribute callback throws at its pickup keeps no marker past the failed render', async () => {
  const kept = globalThis.__markerOutlives;
  kept.armThrower = true;
  const failed = await renderToString(PAGE, { tag: 'outlives-throw-host-ssr' }).then(() => null, (error) => error);
  kept.armThrower = false;
  assert.ok(failed, 'CONTROL: the render failed');
  assert.match(`${failed.message} ${failed.cause?.message}`, /thrower-attribute/, 'CONTROL: it failed in the attribute callback');
  assert.ok(kept.throwerCalls >= 1, 'CONTROL: the callback ran');
  assert.equal(markersIn(kept.thrower), 0, 'the thrower holds no marker after its render');
  const { html } = await renderToString(PAGE, { tag: 'outlives-request-two-ssr' });
  assert.equal(html.includes('vera-ssr-'), false, 'no marker anywhere in the next page');
  assert.equal(kept.thrower.outerHTML.includes('vera-ssr-'), false, 'the kept thrower reads back without a marker');
});
