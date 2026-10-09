/**
 * **A template is marked by what the `'template'` hooks LEFT on it, never by their existing.** A marked template's
 * instances take the marked path (a hook slot, the instance hook, the create scope, `resolved()` per child commit).
 * The renderer used to mark every template once any hook was registered, so an app wiring `elements` (every slots app)
 * put every template on that path, claimed or not. Now the mark is derived from the fields themselves — a resolver
 * (`_$at$`), an instance hook (`_$inst$`), a variant's namespace (`_$ns$`) — so it cannot disagree with them, and the
 * public insert keeps its contract: a hook returns nothing.
 *
 * Read through a spy hook that keeps each template the renderer builds. The mark is `$X` (it was `_x` until hydration
 * step 1, 2026-10-02, which renamed it so the hand-off can read it across bundles): `$`-named, it survives mangling,
 * so BOTH builds assert the mark itself, not only that claims still mount.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];

const { html, svg, wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { elements } = await load('renderer/elements');
const { namespaces } = await load('renderer/namespaces');

/** Every template the renderer builds, by its first static — a hook that leaves nothing. */
const built = new Map();
const spy = { name: 'test/template-spy', on: 'template', fn: (template, result) => void built.set(result.strings[0], template), priority: 99 };
const mounted = [];
const claimant = { name: 'test/claim-mark', on: 'element', fn: (el) => (el.localName === 'mark' ? { mount: (e) => void mounted.push(e.localName), unmount: () => {} } : undefined), priority: 60 };

test('with elements wired, only a template something CLAIMED is marked', () => {
  wire([renderer, elements, claimant, spy]);
  const host = document.createElement('div');
  document.body.append(host);
  renderInto(html`<p>claimed <mark>here</mark></p>`, host);
  renderInto(html`<p>nothing claimed</p>`, host);
  assert.deepEqual(mounted, ['mark'], 'CONTROL: the claim mounted');
  assert.equal(built.get('<p>claimed <mark>here</mark></p>')?.$X, true, 'a claimed template takes the marked path');
  assert.equal(built.get('<p>nothing claimed</p>')?.$X, false, 'an unclaimed one keeps the plain path');
  host.remove();
});

test('with namespaces wired, an html template (its resolver) and an svg variant (only its namespace) are both marked', () => {
  wire([namespaces]);
  const host = document.createElement('div');
  document.body.append(host);
  renderInto(html`<svg>${svg`<circle r="1"></circle>`}</svg>`, host);
  assert.ok(host.querySelector('circle') instanceof dom.window.SVGElement, 'CONTROL: the circle is an SVG element');
  const variant = built.get('<circle r="1"></circle>');
  assert.ok(variant?._$ns$, 'the svg template carries its namespace');
  assert.equal(variant._$at$ === undefined && variant._$inst$ === undefined, true, 'and nothing else — the _$ns$-only row');
  assert.equal(variant.$X, true, 'still marked: its instances must set the create scope');
  assert.equal(built.get('<svg>')?.$X, true, 'an html template with a resolver is marked');
  host.remove();
});
