/**
 * **Namespaces resolve at every place a template becomes an instance**: a child position, a list item (keyed or not),
 * and a position whose parent is still a fragment-rooted instance's detached FRAGMENT — answered through the create
 * scope, by the template being built.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Element', 'DocumentFragment', 'customElements'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { namespaces } = await load('renderer/namespaces');
core.wire([renderer, namespaces]);
const { html } = core;
const SVG = 'http://www.w3.org/2000/svg';
const MATH = 'http://www.w3.org/1998/Math/MathML';
const namespacesOf = (host, sel) => [...host.querySelectorAll(sel)].map((el) => el.namespaceURI);

test('list items in <svg> are SVG — unkeyed and keyed', () => {
  const dot = (i) => html`<circle r=${i}></circle>`;
  const host = document.createElement('div');
  renderInto(html`<svg>${[1, 2].map(dot)}</svg>`, host);
  assert.deepEqual(namespacesOf(host, 'circle'), [SVG, SVG]);
  const keyedHost = document.createElement('div');
  renderInto(html`<svg>${[1, 2].map((i) => keyed(i, dot(i)))}</svg>`, keyedHost);
  assert.deepEqual(namespacesOf(keyedHost, 'circle'), [SVG, SVG]);
});

test("a position at a fragment-rooted template's top level resolves through the template being built", () => {
  const host = document.createElement('div');
  const inner = () => html`<circle r="1"></circle>`;
  renderInto(html`<svg>${html`<g></g>${inner()}`}</svg>`, host);
  assert.deepEqual(namespacesOf(host, 'g, circle'), [SVG, SVG]);
});

test('MathML too', () => {
  const host = document.createElement('div');
  renderInto(html`<math>${html`<mi>x</mi>`}</math>`, host);
  assert.deepEqual(namespacesOf(host, 'mi'), [MATH]);
});
