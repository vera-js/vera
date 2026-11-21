/**
 * **The server reads an open tag's attributes as the parser does, quotes included** (2026-11-21). Removing a name
 * before it is written again, reading an option's `value` and clearing its `selected` were three patterns over the
 * markup already written; none of them had an end to the name or saw quotes, so each matched text the parser reads
 * as part of a value. Every row reads the served markup back through a real parser (jsdom, captured before the shim
 * installs its globals) and asserts what the element holds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const parser = new JSDOM('<!doctype html><body></body>').window.document;
const { serializeTemplate } = await import('@verajs/ssr');
const { html } = await import('@verajs/core');
const { spread } = await import('@verajs/renderer/spread');

/** The first element the served markup parses to. */
const parsed = (markup) => {
  const body = parser.createElement('body');
  body.innerHTML = markup;
  return body.firstElementChild;
};
/** Every attribute the element holds, by name. */
const attributesOf = (element) => Object.fromEntries([...element.attributes].map((a) => [a.name, a.value]));

test('a spread removing a name never reads it inside another value: no attribute is made from a value', () => {
  const served = serializeTemplate(html`<input title=${'a id=b'} ${spread({ id: ' onfocus=pwn() autofocus x' })}>`);
  assert.deepEqual(attributesOf(parsed(served)), { title: 'a id=b', id: ' onfocus=pwn() autofocus x' }, served);
});

test('a name is matched whatever its case, and with spaces around =', () => {
  const upper = serializeTemplate(html`<img SRC="a" ${spread({ src: 'b' })}>`);
  assert.deepEqual(attributesOf(parsed(upper)), { src: 'b' }, upper);
  const spaced = serializeTemplate(html`<input title = "a id=b" ${spread({ id: 'c' })}>`);
  assert.deepEqual(attributesOf(parsed(spaced)), { title: 'a id=b', id: 'c' }, spaced);
});

test('a name is removed by its whole name: src never cuts srcset', () => {
  const served = serializeTemplate(html`<img srcset=${'a.png 1x'} ${spread({ src: 'b.png' })}>`);
  const element = parsed(served);
  assert.equal(element.localName, 'img', served);
  assert.deepEqual(attributesOf(element), { srcset: 'a.png 1x', src: 'b.png' }, served);
});

test('every copy of a name written before is removed, so the last write is the one served', () => {
  const served = serializeTemplate(html`<b title="a" title="b" ${spread({ title: 'c' })}>x</b>`);
  assert.deepEqual(attributesOf(parsed(served)), { title: 'c' }, served);
});

test("an option's value is its value attribute: never data-value, nor value= inside a title", () => {
  for (const served of [
    serializeTemplate(html`<select .value=${'b'}><option data-value="b">a</option><option>b</option></select>`),
    serializeTemplate(html`<select .value=${'b'}><option title="value=b">a</option><option>b</option></select>`),
  ]) {
    const select = parsed(served);
    assert.equal(select.value, 'b', served);
    assert.equal(select.selectedIndex, 1, `the second option is the one selected: ${served}`);
  }
});

test("clearing an author's selected leaves the text of other values alone", () => {
  const served = serializeTemplate(html`<select .value=${'b'}><option title="x selected y" selected>a</option><option>b</option></select>`);
  const select = parsed(served);
  assert.equal(select.options[0].title, 'x selected y', served);
  assert.equal(select.options[0].hasAttribute('selected'), false, served);
  assert.equal(select.selectedIndex, 1, served);
});

test("a name inside a static value is not an attribute: a bound href leaves the title's words alone", () => {
  const served = serializeTemplate(html`<a title="see href docs" href=${'/x'}>x</a>`);
  assert.deepEqual(attributesOf(parsed(served)), { title: 'see href docs', href: '/x' }, served);
});

test('SELECTED and VALUE in capitals are the same attributes: an option list is never skipped by its case', () => {
  const served = serializeTemplate(html`<select .value=${'b'}><option SELECTED>a</option><option VALUE="b">x</option></select>`);
  const select = parsed(served);
  assert.equal(select.options[0].hasAttribute('selected'), false, served);
  assert.equal(select.selectedIndex, 1, served);
  assert.equal(select.value, 'b', served);
});

test("an option's open tag ends where the parser ends it: a > inside a quoted value is not its end", () => {
  /** CONTROL first: the same options without the `>` serve one selected, the bound one. */
  for (const served of [
    serializeTemplate(html`<select .value=${'a'}><option value=a>A</option><option title="x" selected value=b>B</option></select>`),
    serializeTemplate(html`<select .value=${'a'}><option value=a>A</option><option title="x>" selected value=b>B</option></select>`),
  ]) {
    const select = parsed(served);
    assert.equal(select.value, 'a', served);
    assert.equal(select.querySelectorAll('[selected]').length, 1, `one option carries selected: ${served}`);
  }
});

test("a select's open tag ends where the parser ends it: its mark is never served", () => {
  for (const [title, served] of [
    ['ab', serializeTemplate(html`<select title="ab" .value=${'b'}><option>a</option><option>b</option></select>`)],
    ['a>b', serializeTemplate(html`<select title="a>b" .value=${'b'}><option>a</option><option>b</option></select>`)],
  ]) {
    assert.doesNotMatch(served, /data-vm-select/, `title ${title}: the internal mark was served: ${served}`);
    const select = parsed(served);
    assert.equal(select.title, title, served);
    assert.equal(select.value, 'b', `title ${title}: ${served}`);
  }
});

test('names are folded A–Z only, as the tokenizer folds them: KELVIN SIGN is not k', () => {
  const served = serializeTemplate(html`<input chec\u212Aed=x ${spread({ checked: 'y' })}>`);
  assert.deepEqual(attributesOf(parsed(served)), { 'chec\u212Aed': 'x', checked: 'y' }, served);
  /** CONTROL: the ASCII spelling in capitals is the same name, removed before it is written again. */
  const upper = serializeTemplate(html`<input CHECKED=x ${spread({ checked: 'y' })}>`);
  assert.deepEqual(attributesOf(parsed(upper)), { checked: 'y' }, upper);
});

test('an unquoted value holds a quote as text: the tag does not end inside it', () => {
  const served = serializeTemplate(html`<input title=a"b ${spread({ id: 'c' })}>`);
  assert.deepEqual(attributesOf(parsed(served)), { title: 'a"b', id: 'c' }, served);
  const select = serializeTemplate(html`<select title=a"b .value=${'b'}><option>a</option><option>b</option></select>`);
  assert.doesNotMatch(select, /data-vm-select/, select);
  assert.equal(parsed(select).value, 'b', select);
});
