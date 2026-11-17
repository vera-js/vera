/**
 * SSR fixture for tests/script-data-blocks.test.mjs: one component per script shape, each `sh-<index>` in the order of
 * `SHAPES`, so the server and the client render the very same templates.
 */
import { define, html } from '@verajs/core';

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
];
SHAPES.forEach(([, draw], i) => define(`sh-${i}`, () => draw));
