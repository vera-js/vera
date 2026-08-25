/**
 * `svg` and `mathml` — core's namespaced template tags.
 *
 * They existed in `store.ts` from the beginning and were never exported, so the renderer's support
 * for them was unreachable from core's public API: `@verajs/renderer` reads `_$litType$` and wraps
 * the markup in `<svg>` or `<math>` before parsing, precisely so the fragment lands in the right
 * namespace, but nothing in core produced those types. A user had to import lit-html's `svg` or
 * hand-craft `{ _$litType$: 2, strings, values }`.
 *
 * Namespace is the whole point. `document.createElement('circle')` makes an HTMLUnknownElement;
 * only a fragment parsed inside `<svg>` produces a real SVGCircleElement, and only that renders.
 */
import { load } from './dist.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event',
                 'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const { html, svg, mathml } = await load('core');
const { render } = await load('renderer');

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

let host;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

test('core exports both namespaced tags', () => {
  assert.equal(typeof svg, 'function');
  assert.equal(typeof mathml, 'function');
});

test('they produce distinct template types', () => {
  /** The renderer switches on this to decide the parsing context. */
  assert.equal(html``._$litType$, 1);
  assert.equal(svg``._$litType$, 2);
  assert.equal(mathml``._$litType$, 3);
});

test('an svg template renders into the SVG namespace', () => {
  render(html`<svg viewBox="0 0 10 10">${svg`<circle cx="5" cy="5" r="4" />`}</svg>`, host);
  const circle = host.querySelector('circle');
  assert.ok(circle, 'the element exists');
  assert.equal(circle.namespaceURI, SVG_NS, 'and is a real SVG element, not HTMLUnknownElement');
});

test('bindings work inside an svg template', () => {
  render(html`<svg>${svg`<circle cx=${5} r=${4} fill=${'red'} />`}</svg>`, host);
  const circle = host.querySelector('circle');
  assert.equal(circle.getAttribute('cx'), '5');
  assert.equal(circle.getAttribute('r'), '4');
  assert.equal(circle.getAttribute('fill'), 'red');
});

test('an svg template updates in place across renders', () => {
  const draw = (r) => render(html`<svg>${svg`<circle r=${r} />`}</svg>`, host);
  draw(4);
  const first = host.querySelector('circle');
  draw(7);
  assert.equal(host.querySelector('circle'), first, 'the element was updated, not replaced');
  assert.equal(first.getAttribute('r'), '7');
});

test('a mathml template renders into the MathML namespace', () => {
  render(html`<math>${mathml`<mi>${'x'}</mi>`}</math>`, host);
  const mi = host.querySelector('mi');
  assert.ok(mi, 'the element exists');
  assert.equal(mi.namespaceURI, MATHML_NS);
  assert.equal(mi.textContent, 'x', 'and its binding committed');
});

test('a plain html template stays in the HTML namespace', () => {
  /** The control: without the tag, the same markup is not namespaced. */
  render(html`<div><span>plain</span></div>`, host);
  assert.equal(host.querySelector('span').namespaceURI, 'http://www.w3.org/1999/xhtml');
});
