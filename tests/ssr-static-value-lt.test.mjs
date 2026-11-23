/**
 * **A `<` in a static attribute value is value text, and the server's edits to the open tag know it** (2026-11-23).
 * Writing an attribute a second time (a bound duplicate, a form property, a spread key) first removes the earlier
 * write from the tag being built, which was found by the last `<` written. Values are escaped, but a template's own
 * statics are not: in `<input title="a <i value=1" value=${v}>` that `<` sits inside `title`'s quotes, the edit read
 * `<i value=1"` as the tag, removed `value=1"` (the quote that closed `title` with it), and the bound value landed
 * outside every quote: `x onclick=…` became a live attribute, in Chromium, Firefox and WebKit alike. Now such a `<` is
 * served as `&#60;`, which every parser decodes to the same `<` in the value, so no raw `<` follows a tag's own.
 * jsdom parses the served markup here (it agrees with the three engines on these shapes); the browser row is
 * `tests/browser/ssr-static-value-lt.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const { html } = await load('core');
const { spread } = await load('renderer/spread');
/** Last: the server installs its own DOM globals. */
const { serializeTemplate } = await import('@verajs/ssr');
const parser = new JSDOM('<!doctype html><body></body>').window.document;

const VALUE = 'x onclick=alert(1) y';
/** The first element the served markup parses to, as a browser builds it. */
const parsed = (markup) => {
  const template = parser.createElement('template');
  template.innerHTML = markup;
  return template.content.firstElementChild;
};
const attributes = (element) => [...element.attributes].map((a) => `${a.name}=${a.value}`).join(' | ');

test('a bound duplicate after a static value holding `<` stays inside its own quotes', () => {
  for (const [label, draw, name, expected] of [
    ['a bound attribute', (v) => html`<input title="a <i value=1" value=${v}>`, 'title', 'a <i value=1'],
    ['a form property', (v) => html`<input title="a <i value=1" .value=${v}>`, 'title', 'a <i value=1'],
    ['a duplicate name', (v) => html`<b title="a <i title=1" title=${v}>x</b>`, 'title', VALUE],
    ['single quotes', (v) => html`<input title='a <i value=1' value=${v}>`, 'title', 'a <i value=1'],
    ['an unquoted value', (v) => html`<input title=a<i value=1 value=${v}>`, 'title', 'a<i'],
    ['a spread key', (v) => html`<b title="a <i x=1" ${spread({ x: v })}>x</b>`, 'title', 'a <i x=1'],
    ['an unquoted earlier write', (v) => html`<input title="a <i" value=1 value=${v}>`, 'title', 'a <i'],
  ]) {
    const element = parsed(serializeTemplate(draw(VALUE)));
    assert.equal(element.hasAttribute('onclick'), false, `${label}: ${attributes(element)}`);
    assert.equal(element.getAttribute(name), expected, `${label}: the static value is the author's (${attributes(element)})`);
  }
});

test('the bound value is the one written, and the earlier write of its name is gone', () => {
  const input = parsed(serializeTemplate(html`<input title="a <i value=1" value=${VALUE}>`));
  assert.equal(input.getAttribute('value'), VALUE);
  const spreadOne = parsed(serializeTemplate(html`<b title="a <i x=1" x="old" ${spread({ x: VALUE })}>x</b>`));
  assert.equal(spreadOne.getAttribute('x'), VALUE, attributes(spreadOne));
});

test('a static value that reads as a whole tag keeps all of it when a bound name is written again', () => {
  /** The edit read `<i value=1>` as the open tag and removed `value=1` from inside `title`'s quotes. */
  const input = parsed(serializeTemplate(html`<input title="<i value=1>" value=${'v'}>`));
  assert.equal(input.getAttribute('title'), '<i value=1>', attributes(input));
  assert.equal(input.getAttribute('value'), 'v');
  assert.equal(serializeTemplate(html`<input title="<i value=1>" value=${'v'}>`), '<input title="&#60;i value=1>" value="v">');
});

test('CONTROL: a static value without `<` is served as written, and a name inside quotes is not a write', () => {
  assert.equal(serializeTemplate(html`<input title="a b" value=${'v'}>`), '<input title="a b" value="v">');
  /** recordNames counts `value=` inside the quotes as a write; the removal reads the tag as the parser does and finds none. */
  assert.equal(serializeTemplate(html`<input title="a value=1" value=${'v'}>`), '<input title="a value=1" value="v">');
});
