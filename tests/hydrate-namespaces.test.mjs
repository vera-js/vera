/**
 * **Hydration resolves a template's namespace against the LIVE parent**, as a client render does. It matters where the
 * two parsers build different STRUCTURE: HTML reads `<path d="M0"/>` as an open tag, so a following `<circle>` nests
 * inside it, while the SVG the server's markup is parsed as keeps them siblings. Adopting against the HTML parse would
 * disagree with the server's markup and throw it away.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer, renderInto } = await load('renderer/hydrate');
const { namespaces } = await load('renderer/namespaces');
core.wire([renderer, namespaces]);
const { html } = core;

test('an html template inside <svg> adopts the server markup parsed as SVG — self-closed siblings included', () => {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = '<svg><path d="M0"/><circle r="1"/></svg>';
  const [path, circle] = [host.querySelector('path'), host.querySelector('circle')];
  assert.equal(circle.parentNode.localName, 'svg', 'CONTROL: the server markup parsed as siblings');
  const said = [];
  const { warn } = console;
  console.warn = (m) => said.push(String(m));
  try {
    renderInto(html`<svg>${html`<path d=${'M0'}/><circle r=${1}/>`}</svg>`, host);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(said, [], 'adopted, no fallback');
  assert.equal(host.querySelector('path'), path, 'the server nodes were kept');
  assert.equal(host.querySelector('circle'), circle);
});
