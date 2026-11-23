/**
 * **A slash an unquoted value takes does not self-close the tag** (2026-11-23), in development's tag-shape scan.
 * HTML's unquoted-value state keeps a `/`: `<svg class=a/>` is the value `a/` and the `<svg>` stays open, so what
 * follows is foreign content. The scan read the slash as a close, so `<svg class=a/><title><tspan>${x}</tspan></title>`
 * was not refused as a binding the renderer would destroy (`foreign-raw-text`), and `<div class=a/>` was warned as a
 * self-closed `<div />`. A quoted value, a bare name and a hole before the slash still self-close (the renderer writes a
 * space after a hole there). Development only: production renders every row as it always did.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];
const { html } = await load('core');
const { renderInto } = await load('renderer');

/** What the render said and whether it threw. */
const render = (template) => {
  const host = document.createElement('div');
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    renderInto(template, host);
    return { said, threw: '' };
  } catch (error) {
    return { said, threw: error.message };
  } finally {
    console.warn = warn;
  }
};
const selfClosed = ({ said }) => said.some((line) => line.includes('(self-closed-tag)'));

test('an svg whose unquoted value takes the slash stays open: a binding in its title is refused', () => {
  const { threw } = render(html`<svg class=a/><title><tspan>${'x'}</tspan></title></svg>`);
  if (isProduction) return assert.equal(threw, '', 'production pays nothing');
  assert.match(threw, /a binding inside <title> in SVG or MathML/, 'the svg is open, so the title is foreign');
  /** CONTROL: a quoted value before the slash self-closes the svg, and the title after it is HTML's. */
  assert.equal(render(html`<svg class="a"/><title>${'x'}</title>`).threw, '');
});

test('an HTML element whose unquoted value takes the slash is not warned as self-closed; the self-closing forms are', () => {
  if (isProduction) return assert.ok(!selfClosed(render(html`<div class="a"/>${'x'}`)), 'production says nothing');
  for (const [label, template] of [
    ['an unquoted value', () => html`<div class=a/>${'x'}`],
    ['an unquoted value after other attributes', () => html`<div id="i" data-x=1/2/>${'x'}`],
  ])
    assert.ok(!selfClosed(render(template())), label);
  for (const [label, template] of [
    ['a quoted value', () => html`<div class="a"/>${'x'}`],
    ['a bare name', () => html`<div hidden/>${'x'}`],
    ['a space before the slash', () => html`<div class=a />${'x'}`],
    ['a hole before the slash', () => html`<div class=${'a'}/>${'x'}`],
    ['a quote holding an equals sign', () => html`<div title="a= b"/>${'x'}`],
  ])
    assert.ok(selfClosed(render(template())), `${label}: still a self-closed <div />`);
});
