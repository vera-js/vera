/**
 * SSR fixture: the svg/mathml corpus (`../lite-namespace-sources.mjs`) as lite components on the server's DOM, light DOM,
 * so the served elements are in the document a test parses (a declarative shadow root parses as an inert `<template>` in
 * jsdom) — `tests/lite-ssr.test.mjs`. Then the server rows for svg and mathml values: a value in an SVG `<style>` or
 * `<title>` (text, never markup) in lite and in core, and a hole in an SVG or MathML `<script>` (refused by lite).
 */
import * as lite from '@verajs/lite';
import { define as coreDefine, html as coreHtml } from '@verajs/core';
import { SOURCES } from '../lite-namespace-sources.mjs';

for (const [i, source] of Object.values(SOURCES).entries()) lite.define({ tag: `ssr-ns-${i}`, props: { v: 'a' } }, source(lite));

const attack = (end) => `</${end}><img src=x onerror=alert(1)>`;
const VALUES = {
  'svg-style': (h) => h`<svg><style>.a{fill:${attack('style')}}</style></svg>`,
  'svg-title': (h) => h`<svg><title>${attack('title')}</title></svg>`,
  'math-style': (h) => h`<math><mi><style>.a{color:${attack('style')}}</style></mi></math>`,
  'svg-xlink': (h) => h`<svg><a xlink:href=${'javascript:alert(1)'}><text>x</text></a><a xlink:href=${'#ok'}><text>y</text></a></svg>`,
  'svg-script': (h) => h`<svg><script>${'alert(1)'}</script></svg>`,
  'math-script': (h) => h`<math><mi><script>${'alert(1)'}</script></mi></math>`,
};
for (const [name, draw] of Object.entries(VALUES)) {
  lite.define(`ssr-lite-${name}`, () => () => draw(lite.html));
  if (!name.endsWith('script')) coreDefine(`ssr-core-${name}`, () => () => draw(coreHtml));
}
