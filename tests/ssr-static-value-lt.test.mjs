/**
 * **A `<` in a static attribute value is value text, and the server's edits to the open tag know it** (2026-11-23).
 * Writing an attribute a second time (a bound duplicate, a form property, a spread key) first removes the earlier
 * write from the tag being built, which was found by the last `<` written. Values are escaped, but a template's own
 * statics are not: in `<input title="a <i value=1" value=${v}>` that `<` sits inside `title`'s quotes, the edit read
 * `<i value=1"` as the tag, removed `value=1"` (the quote that closed `title` with it), and the bound value landed
 * outside every quote: `x onclick=…` became a live attribute, in Chromium, Firefox and WebKit alike. Now such a `<` is
 * served as `&#60;`, which every parser decodes to the same `<` in the value. A `<` in a name or unquoted value has no
 * such spelling, and the plan keeps where the tag starts instead (below). jsdom parses the served markup here (it
 * agrees with the three engines on these shapes); the browser rows are in `tests/browser/ssr-parse-agreement.test.js`.
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

/**
 * **A `<` in a static NAME or unquoted value** has no other spelling here, so the plan keeps where the open tag starts
 * instead (`tagBacks`): by the last `<`, `<b id=a title=x<c id=${v}>` read `<c id=` as the tag, the earlier `id=a` stayed
 * and was served first, so the page read `a` where the client's `setAttribute` makes it the bound value (Chromium,
 * Firefox and WebKit). A spread key and a form property take the same edit.
 */
test('a `<` in a static name or unquoted value: the bound write replaces the earlier one', () => {
  for (const [label, draw, check] of [
    ['an unquoted value', (v) => html`<b id=a title=x<c id=${v}>t</b>`, (e) => e.getAttribute('title') === 'x<c'],
    ['a name', (v) => html`<b id=a x<c=1 id=${v}>t</b>`, (e) => e.getAttribute('x<c') === '1'],
    ['a spread key', (v) => html`<b id=a title=x<c ${spread({ id: v })}>t</b>`, (e) => e.getAttribute('title') === 'x<c'],
    ['two tags, the second holding it', (v) => html`<i id=q>${v}</i><b id=a x<c=1 id=${v}>t</b>`, (e) => e.getAttribute('x<c') === '1'],
    ['across two holes', (v) => html`<b id=a x<c=${v} id=${v}>t</b>`, (e) => e.getAttribute('x<c') === 'B'],
  ]) {
    const served = serializeTemplate(draw('B'));
    const element = parsed(served.replace(/^<i[^]*?<\/i>/, ''));
    assert.equal(element.getAttribute('id'), 'B', `${label}: ${served}`);
    assert.equal(element.getAttributeNames().filter((n) => n === 'id').length, 1, label);
    assert.ok(check(element), `${label}: ${attributes(element)}`);
  }
});

/** The shapes around it: a later static, a boolean, the first of two tags, and a nested template's two elements. */
test('a `<` in a name: a later static of the tag, a boolean, two tags, a nested template', () => {
  const ids = (markup) => {
    const holder = parser.createElement('template');
    holder.innerHTML = markup;
    return [...holder.content.querySelectorAll('*')].map((e) => `${e.localName}#${e.getAttribute('id')}`).join(' ');
  };
  for (const [label, template, expected] of [
    ['a later static of the same tag', html`<b id=a data-x=${'v'} x<c id=${'B'}>t</b>`, 'b#B'],
    ['a boolean', html`<b id=a title=x<c ?id=${true}>t</b>`, 'b#'],
    ['the first of two tags', html`<b id=a x<c=1 id=${'B'}>t</b><i id=q id=${'C'}>u</i>`, 'b#B i#C'],
    ['a nested template, outer and inner', html`<b id=a title=x<c id=${'B'}>${html`<i id=a t=x<y id=${'C'}>u</i>`}</b>`, 'b#B i#C'],
  ]) {
    const served = serializeTemplate(template);
    assert.equal(ids(served), expected, `${label}: ${served}`);
  }
});

test('CONTROL: the same tags without a `<` are edited as before', () => {
  const served = serializeTemplate(html`<b id=a title=xc id=${'B'}>t</b>`);
  assert.equal(parsed(served).getAttribute('id'), 'B', served);
  assert.equal(parsed(serializeTemplate(html`<b id=a title=x<c>t</b>`)).getAttribute('title'), 'x<c');
});
