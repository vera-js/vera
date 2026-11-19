/**
 * SSR fixture for tests/script-data-blocks.test.mjs: one component per script shape, each `sh-<index>` in the order of
 * `SHAPES`, so the server and the client render the very same templates.
 */
import { define, html } from '@verajs/core';
import { spread } from '@verajs/renderer/spread';

const V = '{"a":"<!--<script></script>"}';
/** [name, draw, accepted]: whether the shape is a JSON data block (the rule both sides apply). */
export const SHAPES = [
  ['json', () => html`<script type="application/json">${V}</script>`, true],
  ['ld+json', () => html`<script type="application/ld+json">${V}</script>`, true],
  ['two holes in one block', () => html`<script type="application/json">{"a":${'1'},"b":${'2'}}</script>`, true],
  ['a parameter (inert)', () => html`<script type="text/javascript; x=json">${V}</script>`, true],
  ['plain', () => html`<script>${'zq()'}</script>`, false],
  ['module', () => html`<script type="module">${'zq()'}</script>`, false],
  ['type=""', () => html`<script type="">${'zq()'}</script>`, false],
  ['a type hole', () => html`<script type=${'application/json'}>${'1'}</script>`, false],
  ['a fake start tag in script text', () => html`<script>var s = "<script type=application/json>"; f(${'x'})</script>`, false],
  ['a fake start tag in a quoted value', () => html`<p title="<script type=application/json>"></p><script>${'zq()'}</script>`, false],
  ['a reference &#47;', () => html`<script type="application&#47;json">${'1'}</script>`, false],
  ['a single-quoted reference', () => html`<script type='application&#47;json'>${'1'}</script>`, false],
  ['a quoted ">" then a reference', () => html`<script data-x=">" type="application&#47;json">${'1'}</script>`, false],
  ['type= inside another value', () => html`<script data-x=" type=application/json">${'zq()'}</script>`, false],
  /**
   * Foreign scripts (2026-11-18): an SVG `<script>` runs on a served page and from a template in Chromium and WebKit, so
   * a hole in one is refused, JSON or not (a foreign script is no data block); a MathML element named `script` is
   * refused too (harmless over-refusal); an `<svg>` inside `annotation-xml` is SVG.
   */
  ['svg script', () => html`<svg><script>${'zq()'}</script></svg>`, false],
  ['svg script, a JSON type', () => html`<svg><script type="application/json">${'1'}</script></svg>`, false],
  ['svg script, the hole in a child', () => html`<svg><script><g>${'zq()'}</g></script></svg>`, false],
  ['a MathML element named script', () => html`<math><mrow><script>${'zq()'}</script></mrow></math>`, false],
  ['svg in annotation-xml, its script', () => html`<math><annotation-xml><svg><script>${'zq()'}</script></svg></annotation-xml></math>`, false],
  ['an svg script closed, then a hole', () => html`<svg><script>go()</script><text>${'ok'}</text></svg>`, true],
  /**
   * A JSON block whose script carries a binding of its own (2026-11-18): the binding can change the type after it was
   * judged (`?type=${false}` removes it; a spread or `.type` sets a script type), and the script is then served — or
   * saved from the DOM — as code holding the value. Refused: a script with a content hole carries static attributes only.
   */
  ['a JSON block, ?type bound', () => html`<script type="application/json" ?type=${false}>${'zq()'}</script>`, false],
  ['a JSON block, .type bound', () => html`<script type="application/json" .type=${'text/javascript'}>${'zq()'}</script>`, false],
  ['a JSON block, !type bound', () => html`<script type="application/json" !type=${'text/javascript'}>${'zq()'}</script>`, false],
  ['a JSON block, a spread', () => html`<script type="application/json" ${spread({ type: 'text/javascript' })}>${'zq()'}</script>`, false],
];
SHAPES.forEach(([, draw], i) => define(`sh-${i}`, () => draw));
