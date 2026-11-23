/**
 * **The server reads raw text where the browser does** (2026-11-23), in its DOM. Two places it did not:
 *
 * - **A `<style>` or `<script>`'s text is raw only where a browser parses the element as HTML.** An HTML `<style>`
 *   appended to an `<svg>` is served as `<svg><style>…</style>`, and a browser reads that style as SVG's, its content
 *   markup: the text was written raw, so `<img src=x onerror=…>` in a style's text was an element in Chromium, Firefox
 *   and WebKit. The nearest ancestor outside HTML decides (an integration point's content is HTML again).
 * - **A script's text has escape states.** After `<!--` and then `<script`, a `</script>` ends nothing: the server's
 *   parser ended the script at the first one, as the template compiler did (`script-data-blocks.test.mjs`).
 *
 * jsdom parses the served markup (it agrees with the three engines here; `tests/browser/ssr-parse-agreement.test.js`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import '@verajs/ssr';

const parser = new JSDOM('<!doctype html><body></body>').window.document;
const parsed = (markup) => {
  const template = parser.createElement('template');
  template.innerHTML = markup;
  return template.content;
};
const SVG = 'http://www.w3.org/2000/svg';
const TEXT = '<img src=x onerror="ran()"> a > b';

test('an HTML style or script inside an svg is served as text the svg reads as text', () => {
  for (const name of ['style', 'script']) {
    const svg = document.createElementNS(SVG, 'svg');
    const element = document.createElement(name);
    element.textContent = TEXT;
    svg.append(element);
    const served = parsed(svg.outerHTML);
    assert.equal(served.querySelector('img'), null, `${name}: ${svg.outerHTML}`);
    assert.equal(served.querySelector(`svg ${name}`).textContent, TEXT, `${name}: the text as written`);
  }
});

test('inside an integration point, and with no foreign ancestor, the text is raw, as the browser reads it', () => {
  const svg = document.createElementNS(SVG, 'svg');
  const point = document.createElementNS(SVG, 'foreignObject');
  const style = document.createElement('style');
  style.textContent = 'a > b {}';
  point.append(style);
  svg.append(point);
  assert.match(svg.outerHTML, /<style>a > b \{\}<\/style>/, 'raw inside foreignObject');
  const div = document.createElement('div');
  const plain = document.createElement('style');
  plain.textContent = 'a > b {}';
  div.append(plain);
  assert.equal(div.innerHTML, '<style>a > b {}</style>', 'CONTROL: raw in HTML');
});

test("a double-escaped script runs to its second </script> in the server's parser too", () => {
  const holder = document.createElement('div');
  holder.innerHTML = "<script><!--\nvar s = '<script></script>';\nvar n = 1;\n//--></script><p>after</p>";
  assert.equal(holder.querySelectorAll('script').length, 1);
  assert.match(holder.querySelector('script').textContent, /var n = 1;/);
  assert.equal(holder.querySelector('p').textContent, 'after');
  /** CONTROL: an escaped script with no inner `<script` ends at its first `</script>`. */
  const plain = document.createElement('div');
  plain.innerHTML = '<script><!-- x </script><p>after</p>';
  assert.equal(plain.querySelector('p')?.textContent, 'after');
});
