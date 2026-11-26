/**
 * **A bound `color`, `face` or `size` on a `<font>` inside `<svg>` or `<math>` is said, once per template** (2026-11-26).
 *
 * The client parses its template with a marker where a bound attribute goes, so it builds that `<font>` as SVG or
 * MathML; the browser's parse of the served `<font color="red">` leaves foreign content at it (HTML's conditional
 * breakout for exactly those three names), so the served tree differs from the client's. SVG's `<font>` is obsolete:
 * the markup is served as written and the server says so, as `ssr-font-in-foreign`, from compile — never per render.
 * A `<font>` in HTML, or in an integration point's HTML content, breaks out of nothing and says nothing.
 *
 * Each site is one `draw()` called more than once: two template literals are two templates.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { serializeTemplate } = await import('@verajs/ssr');
const { html } = await load('core');

const heard = (render) => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.map(String).join(' '));
  try {
    render();
  } finally {
    console.warn = warn;
  }
  return said.filter((line) => line.includes('ssr-font-in-foreign'));
};

const inSvg = (c) => html`<svg><font color=${c}>t</font></svg>`;
const sizeInSvg = (on) => html`<svg><font ?size=${on}>t</font></svg>`;
const upperInMath = (f) => html`<math><FONT FACE="${f}">t</FONT></math>`;
const QUIET = {
  'in HTML': (c) => html`<p><font color=${c}>t</font></p>`,
  'in a foreignObject': (c) => html`<svg><foreignObject><font color=${c}>t</font></foreignObject></svg>`,
  'in a MathML text point': (c) => html`<math><mi><font color=${c}>t</font></mi></math>`,
  'another name on the font': (c) => html`<svg><font id=${c}>t</font></svg>`,
  'the name on another element': (c) => html`<svg><text color=${c}>t</text></svg>`,
};

test('a bound color on a <font> in <svg> is said once for its template, however often it renders', () => {
  const said = heard(() => {
    for (let n = 0; n < 3; n++) serializeTemplate(inSvg('red'));
  });
  assert.equal(said.length, 1, `heard ${said.length} times`);
  assert.ok(said[0].startsWith('[vera] ssr:'), said[0]);
  assert.ok(said[0].includes('binds `color` on a <font> inside <svg> or <math>'), said[0]);
  /** Served as written: the warning changes no byte. */
  assert.ok(serializeTemplate(inSvg('red')).includes('<font color="red">'));
});

test('every one of the three names, a `?` binding and any case: each template its own line', () => {
  assert.equal(heard(() => [serializeTemplate(sizeInSvg(true)), serializeTemplate(sizeInSvg(false))]).length, 1);
  const face = heard(() => [serializeTemplate(upperInMath('serif')), serializeTemplate(upperInMath('mono'))]);
  assert.equal(face.length, 1, `heard ${face.length} times`);
  assert.ok(face[0].includes('binds `face`'), face[0]);
});

test('a template rendered into foreign content says it once, however many positions compile it', () => {
  /** One child template, compiled once per foreign position it is rendered into (svg and math are two plans), and once at the top, where it is HTML. */
  const child = (c) => html`<font color=${c}>t</font>`;
  const said = heard(() => [
    serializeTemplate(child('red')),
    serializeTemplate(html`<svg>${child('red')}</svg>`),
    serializeTemplate(html`<math>${child('red')}</math>`),
  ]);
  assert.equal(said.length, 1, `heard ${said.length} times`);
});

test('a <font> where nothing breaks out says nothing (CONTROL: the same name, or the same place, elsewhere)', () => {
  for (const [label, draw] of Object.entries(QUIET))
    assert.deepEqual(heard(() => serializeTemplate(draw('red'))), [], label);
});
