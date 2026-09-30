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

/** The SVG build of an html template is its own template: a claimant is asked about ITS content — SVG elements. */
test("a claim inside svg content is asked on the SVG variant, not the html original", async () => {
  const { elements } = await load('renderer/elements');
  const asked = [];
  const quiet = console.warn;
  console.warn = () => {};
  try {
    core.wire([elements, { on: 'element', fn: (el) => { if (el.localName === 'rect') asked.push(el.namespaceURI); }, priority: 50 }]);
  } finally {
    console.warn = quiet;
  }
  const host = document.createElement('div');
  const shape = () => html`<rect width="1"></rect><!-- a fresh template, built after the claimant was wired -->`;
  renderInto(html`<svg>${shape()}</svg>`, host);
  assert.equal(host.querySelector('rect').namespaceURI, SVG, 'CONTROL: rendered as SVG');
  assert.ok(asked.includes(SVG), `the claimant saw the SVG variant's element: ${asked.join(', ')}`);
});

/** The parser is asked once per KIND of parent: two different <g> elements share one answer. */
test('the namespace probe runs once per kind of parent, not once per parent element', () => {
  const clone = dom.window.Element.prototype.cloneNode;
  let probes = 0;
  dom.window.Element.prototype.cloneNode = function (deep) {
    if (deep === false && this.namespaceURI === SVG) probes++;
    return clone.call(this, deep);
  };
  try {
    const leaf = () => html`<line x1="0"></line><!-- unique -->`;
    const a = document.createElement('div');
    const b = document.createElement('div');
    renderInto(html`<svg><polyline></polyline><switch>${leaf()}</switch></svg>`, a);
    renderInto(html`<svg><switch>${leaf()}</switch><!-- another parent element, the same kind --></svg>`, b);
    assert.equal(b.querySelector('line').namespaceURI, SVG, 'CONTROL: resolved');
    assert.ok(probes <= 1, `probed ${probes} times for two <switch> parents`);
  } finally {
    dom.window.Element.prototype.cloneNode = clone;
  }
});

/** `<annotation-xml encoding="text/html">` is an HTML integration point: its children are HTML, as the parser decides. */
test('annotation-xml with an HTML encoding takes HTML children; without one, MathML', () => {
  const parsed = document.createElement('div');
  parsed.innerHTML = '<math><annotation-xml encoding="text/html"><div></div></annotation-xml><annotation-xml><mi></mi></annotation-xml></math>';
  const block = () => html`<div>x</div><!-- html block -->`;
  const ident = () => html`<mi>y</mi><!-- math ident -->`;
  const host = document.createElement('div');
  renderInto(html`<math><annotation-xml encoding="text/html">${block()}</annotation-xml><annotation-xml>${ident()}</annotation-xml></math>`, host);
  assert.equal(host.querySelector('div').namespaceURI, parsed.querySelector('div').namespaceURI, 'HTML inside the text/html one');
  assert.equal(parsed.querySelector('div').namespaceURI, 'http://www.w3.org/1999/xhtml', 'CONTROL: the parser says HTML');
  assert.equal(host.querySelector('mi').namespaceURI, MATH, 'MathML inside the plain one');
});
