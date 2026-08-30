/**
 * Four production renderer bundles, loaded together and used together — a CDN page.
 *
 * `@verajs/renderer` is the **only** package that opts into property mangling (`/^_[a-z]/`, see
 * `defaultRollupConfig.js`), and it emits six independent bundles. Each is minified on its own, so
 * terser assigns short names per bundle with no knowledge of the others. Anything written in one and
 * read in another must be spelled identically in both.
 *
 * The argument that it always is — every cross-bundle name is `$`-prefixed (`$k`, `$u`, `$m`, `$r`)
 * or `_$…$`, neither of which can match `/^_[a-z]/` — is a **code reading**, and this repo does not
 * accept those for build-shaped questions.
 *
 * `tests/minification-contracts.test.mjs` already asserts those names **survive as text** in the
 * shipped files. That is weaker than it looks: a name can be present in both bundles and still be
 * written by one and read by another under different meanings. Text presence cannot tell. This runs
 * them.
 *
 * Production artifacts by path on purpose, like `minification-contracts` — the mangling is the
 * subject, so there is nothing to test in the development build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent',
])
  globalThis[key] = dom.window[key];

const D = dom.window.document;
const at = (file) => new URL(`../packages/renderer/dist/${file}`, import.meta.url).href;

/** Each of these is a standalone bundle, exactly as a separate CDN `<script>` would load it. */
const { renderInto, hold } = await import(at('vera-renderer.min.js'));
const { keyed } = await import(at('vera-renderer-keyed.min.js'));
const { spread } = await import(at('vera-renderer-spread.min.js'));
const { tag, html: tagHtml } = await import(at('vera-renderer-tag.min.js'));
const { html } = await import(new URL('../packages/core/dist/vera.min.js', import.meta.url).href);

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * `keyed()` marks a result with `$k`/`$r` in one bundle; the renderer's list reconciliation reads
 * them in another. Reordering is the assertion that matters — a list that renders but rebuilds every
 * node would look identical in the markup and has lost the entire point of the key.
 */
test('keyed from its own bundle reorders nodes in the main bundle', async () => {
  const host = D.createElement('div');
  const draw = (rows) => html`<ul>${rows.map((n) => keyed(n, html`<li>${n}</li>`))}</ul>`;

  renderInto(draw([1, 2, 3]), host);
  await frame();
  assert.equal(host.querySelector('ul').textContent, '123');
  const firstNode = host.querySelector('li');

  renderInto(draw([3, 2, 1]), host);
  await frame();
  assert.equal(host.querySelector('ul').textContent, '321', 'the reordered list is wrong');
  assert.equal(
    host.querySelector('li:last-child'),
    firstNode,
    'the node for key 1 was rebuilt rather than moved — the key contract did not cross the bundle boundary'
  );
});

/** `spread()` builds `{ _props, _$apply$, _$attrs$ }`; the renderer calls `_$apply$` with it as `this`. */
test('spread from its own bundle applies through the main bundle', async () => {
  const host = D.createElement('div');
  renderInto(html`<p ${spread({ id: 'x', 'data-n': 1, '.title': 't' })}></p>`, host);
  await frame();
  const p = host.querySelector('p');
  assert.equal(p.getAttribute('id'), 'x');
  assert.equal(p.getAttribute('data-n'), '1');
  /** The property path, which is the half that travels through `_props` inside spread's own bundle. */
  assert.equal(p.title, 't', 'the property binding did not survive the bundle boundary');
});

/** A tag built by one bundle, interpolated into a template rendered by another. */
test('tag from its own bundle renders through the main bundle', async () => {
  const host = D.createElement('div');
  const heading = tag`h2`;
  renderInto(tagHtml`<${heading} class="a">hi</${heading}>`, host);
  await frame();
  assert.equal(host.innerHTML.replace(/<!---->/g, ''), '<h2 class="a">hi</h2>');
});

/**
 * `hold` lives in the main bundle but its whole value is DOM identity across a swap, which is what a
 * mangling mismatch would silently destroy — the markup would still look right.
 */
test('hold keeps user state across a swap, against the production bundle', async () => {
  const host = D.createElement('div');
  const draw = (on) => html`<div>${hold(on ? html`<input class="i">` : html`<em>off</em>`)}</div>`;

  renderInto(draw(true), host);
  await frame();
  host.querySelector('.i').value = 'typed';

  renderInto(draw(false), host);
  await frame();
  renderInto(draw(true), host);
  await frame();

  assert.equal(host.querySelector('.i')?.value, 'typed', 'hold rebuilt the input instead of re-adopting it');
});
