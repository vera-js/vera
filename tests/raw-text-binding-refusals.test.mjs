/**
 * **Two binding shapes the client could never render are refused in development — production pays nothing.**
 *
 * Inside `<svg>`/`<math>`, a `<title>` or `<style>` is a foreign element whose content the browser reads as markup,
 * while the renderer reads it as raw text and rebuilds that text around its bindings — destroying any element inside
 * it. And `<xmp>`, `<noembed>`, `<noframes>` and `<plaintext>` are text to the parser whole, which the scanner does
 * not list, so a binding there never rendered (the old symptom: a misleading "the parser DROPPED the element"
 * warning and a marker left in the page). Their legitimate neighbors — text bound directly in an SVG `<title>`, an
 * element there with no binding, an attribute on the `<title>` itself, static obsolete content — are untouched.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];
const { html, svg } = await load('core');
const { renderInto } = await load('renderer');

const render = (template) => {
  const host = document.createElement('div');
  const { warn } = console;
  console.warn = () => {};
  try {
    renderInto(template, host);
    return host.innerHTML.replace(/<!---->/g, '');
  } catch (error) {
    return `THREW ${error.message}`;
  } finally {
    console.warn = warn;
  }
};

const REFUSED = {
  'svg title: text binding beside an element': () => html`<svg><title>${'x'}<tspan>y</tspan></title></svg>`,
  'svg title: binding inside an element': () => html`<svg><title><tspan>${'x'}</tspan></title></svg>`,
  'svg style: binding inside an element': () => html`<svg><style><a href=${'x'}></a></style></svg>`,
  'an svg template': () => svg`<title><tspan>${'x'}</tspan></title>`,
  xmp: () => html`<xmp>${'x'}</xmp>`,
  noembed: () => html`<noembed>${'x'}</noembed>`,
  noframes: () => html`<noframes>${'x'}</noframes>`,
  plaintext: () => html`<plaintext>${'x'}`,
};
const ALLOWED = {
  'svg title: text only': [() => html`<svg><title>${'Revenue'}</title></svg>`, '<svg><title>Revenue</title></svg>'],
  'svg style: text only': [() => html`<svg><style>${'.a{}'}</style></svg>`, '<svg><style>.a{}</style></svg>'],
  'svg title: an element, no binding': [() => html`<svg><title>a <tspan>y</tspan></title></svg>`, '<svg><title>a <tspan>y</tspan></title></svg>'],
  'svg title: an attribute on the title itself': [() => html`<svg><title class=${'c'}>t</title></svg>`, '<svg><title class="c">t</title></svg>'],
  'xmp: static': [() => html`<xmp>static</xmp>`, '<xmp>static</xmp>'],
  'html title': [() => html`<title>${'x'}</title>`, '<title>x</title>'],
};

test('the two shapes are refused in development, naming the fix; production renders them as it always did', () => {
  for (const [label, make] of Object.entries(REFUSED)) {
    const out = render(make());
    if (isProduction) assert.ok(!out.startsWith('THREW'), `${label}: production pays nothing`);
    else assert.match(out, /^THREW renderer: a binding inside <(title|style|xmp|noembed|noframes|plaintext)>/, `${label}: ${out}`);
  }
});

test('the messages say what to do instead', () => {
  if (isProduction) return;
  assert.match(render(REFUSED['svg title: binding inside an element']()), /Bind text directly in the <title>/);
  assert.match(render(REFUSED.xmp()), /Use <pre>/);
});

test('their legitimate neighbors render exactly as before', () => {
  for (const [label, [make, expected]] of Object.entries(ALLOWED)) assert.equal(render(make()), expected, label);
});
