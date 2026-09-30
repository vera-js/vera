/**
 * **A namespace-resolved template re-derives every refusal.** With `@verajs/renderer/namespaces` wired, an `html`
 * template committed into `<svg>` is parsed AS SVG — a new template built from the same strings in another context —
 * so every construction-time decision runs again there rather than being copied: a bound `javascript:` URL on an svg
 * `<a>` is refused, a bound inline handler is refused, and a `<foreignObject>` inside returns to HTML, where HTML's
 * rules apply to its bindings.
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
const { namespaces } = await load('renderer/namespaces');
core.wire([renderer, namespaces]);
const { html } = core;
const SVG = 'http://www.w3.org/2000/svg';
const quietly = (work) => {
  const { warn } = console;
  console.warn = () => {};
  try { work(); } finally { console.warn = warn; }
};

test('CONTROL: an html template committed into <svg> is parsed as SVG', () => {
  const host = document.createElement('div');
  renderInto(html`<svg>${html`<circle r="1"></circle>`}</svg>`, host);
  assert.equal(host.querySelector('circle').namespaceURI, SVG);
});

test('a bound javascript: href on an svg <a> is refused there', () => {
  const host = document.createElement('div');
  quietly(() => renderInto(html`<svg>${html`<a href=${'javascript:alert(1)'}><text>x</text></a>`}</svg>`, host));
  const a = host.querySelector('a');
  assert.equal(a.namespaceURI, SVG, 'CONTROL: the <a> is SVG');
  assert.equal(a.getAttribute('href'), null);
});

test('a bound inline handler is refused there', () => {
  const host = document.createElement('div');
  quietly(() => renderInto(html`<svg>${html`<rect onclick=${'alert(1)'}></rect>`}</svg>`, host));
  const rect = host.querySelector('rect');
  assert.equal(rect.namespaceURI, SVG, 'CONTROL: the <rect> is SVG');
  assert.equal(rect.getAttribute('onclick'), null);
});

test("a <foreignObject> returns to HTML, and HTML's rules apply to its bindings", () => {
  const host = document.createElement('div');
  quietly(() =>
    renderInto(html`<svg>${html`<foreignObject><a href=${'javascript:alert(1)'} title=${'t'}>x</a></foreignObject>`}</svg>`, host)
  );
  const a = host.querySelector('foreignObject a');
  assert.equal(a.namespaceURI, 'http://www.w3.org/1999/xhtml', 'CONTROL: the <a> inside is HTML');
  assert.equal(a.getAttribute('href'), null, 'its javascript: href is refused');
  assert.equal(a.getAttribute('title'), 't', 'and its other bindings commit');
});

/** Templates decide their extensions once, as they are built: a module wired after that is named in development. */
test('wiring a template module after the renderer built templates is named in development', { skip: (await import('./dist.mjs')).isProduction && 'diagnostics are folded away' }, async () => {
  const { elements } = await load('renderer/elements');
  const said = [];
  const { warn } = console;
  console.warn = (m) => said.push(String(m));
  try {
    core.wire([elements]);
  } finally {
    console.warn = warn;
  }
  assert.ok(said.some((m) => m.startsWith("[vera] wire: a 'template' or 'element' module")), said.join('\n'));
});
