/**
 * Escaping at the server render boundary — principle #8's "a rendering library is an XSS engine if
 * you get this wrong".
 *
 * The client path is safe by construction: `setAttribute` and `textContent` store strings, they do
 * not parse markup, so a hostile value is inert whatever it contains. `tests/renderer.test.mjs`
 * covers that. The server has no such guarantee — it concatenates a string, and one unescaped
 * quote inside an attribute closes it and starts a new one, which is a script handler on the very
 * next token. Nothing asserted that until this file: `tests/ssr-native.test.mjs` checks text
 * escaping and never tested an attribute position.
 *
 * The assertions **parse** the output rather than grep it. The first version of this file matched
 * `/onload\s*=/` against the raw string and reported two failures on correct output: the escaped
 * attribute value legitimately contains the characters `onload=`, inert inside `&#34;`. Grepping
 * markup for dangerous substrings asks the wrong question. The right one is what an HTML parser
 * concludes, which is what a browser will do.
 */
import { renderToString } from '@verajs/ssr/vera';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { html: markup } = await renderToString(new URL('./fixtures/ssr/xss-ssr.js', import.meta.url));
const { html: cssMarkup } = await renderToString(new URL('./fixtures/ssr/cssxss-ssr.js', import.meta.url));

/**
 * Read through the `<template>` rather than a shadow root: jsdom does not parse declarative shadow
 * DOM, so `host.shadowRoot` is null here. The template's `.content` is produced by the same HTML
 * parser against the same bytes, which is all this file needs — the question is what a parser makes
 * of the markup, not how the element tree is later attached.
 */
const dom = new JSDOM(`<!doctype html><body>${markup}</body>`);
const host = dom.window.document.querySelector('xss-ssr');
const root = host.querySelector('template').content;
const elements = [host, ...root.querySelectorAll('*')];

test('a hostile value in text position cannot become an element', () => {
  assert.equal(root.querySelector('img'), null, 'no element was created from the payload');
  assert.ok(root.textContent.includes('<img src=x onerror=alert(1)>'),
    'it survives as text, which is the whole point — escaped, not stripped');
});

test('a double-quote payload cannot break out of its attribute', () => {
  /**
   * The template writes `title=${x}` and the payload is `" onload="alert(1)" x="`. If the quote
   * survived raw, `title` would close early and `onload` would parse as a second attribute.
   */
  const div = root.querySelector('div[title]');
  assert.equal(div.getAttribute('title'), '" onload="alert(1)" x="',
    'the whole payload is one attribute value, decoded back to exactly what was bound');
  assert.equal(div.getAttribute('onload'), null, 'and produced no second attribute');
});

test('a single-quote payload cannot break out either', () => {
  const div = root.querySelector('div[data-x]');
  assert.equal(div.getAttribute('data-x'), "' onload='alert(1)' x='");
  assert.equal(div.getAttribute('onload'), null);
});

test('a property binding mirrored to an attribute is escaped too', () => {
  /** `.value=${x}` is written as `value="…"` for hydration; same string, same hazard. */
  const input = root.querySelector('input');
  assert.equal(input.getAttribute('value'), '" onload="alert(1)" x="');
  assert.equal(input.getAttribute('onload'), null);
});

test('no element in the tree carries an inline event handler', () => {
  /**
   * The broad net, asked of the parser rather than the string: whatever the payloads contain,
   * nothing may end up as an `on*` attribute on any element.
   */
  for (const element of elements) {
    const handlers = [...element.attributes].map((a) => a.name).filter((n) => /^on[a-z]+$/i.test(n));
    assert.deepEqual(handlers, [], `<${element.localName}> carries ${handlers.join(', ')}`);
  }
});

test('the payloads really are present, so nothing above passes vacuously', () => {
  assert.ok(markup.includes('alert(1)'), 'the hostile strings reached the output — inert');
  assert.ok(elements.length > 4, `expected the full tree, parsed ${elements.length} elements`);
});

test('CSS text cannot break out of the <style> element it is written into', () => {
  /**
   * Regression for a real XSS, found 2026-08-23 by sweeping every markup sink in the tree.
   *
   * `css` is a plain concatenation and escapes nothing, deliberately — the constructed-stylesheet
   * path must receive exactly the CSS the author wrote. The server then wrapped that text in
   * `<style>…</style>`, and `<style>` is a raw-text element: the tokenizer scans it for one thing,
   * its end tag. A value interpolated into `css` carrying `</style>` closed the element and
   * everything after it parsed as markup — a real parser built an `<img>` with a live `onerror`.
   *
   * The client was never directly exploitable, since fragment parsing into a `<style>` creates no
   * nodes (verified in all three engines), but it produced a DOM whose serialization was poisoned.
   *
   * `escapeHtml` is the wrong tool and would break every stylesheet, because `>` is a child
   * combinator. Only the end-tag sequence matters, and `<\\/style` is valid CSS.
   */
  const dom2 = new JSDOM(`<!doctype html><body>${cssMarkup}</body>`);
  const tpl = dom2.window.document.querySelector('cssxss-ssr > template');
  const style = tpl.content.querySelector('style');

  assert.equal(tpl.content.querySelector('img'), null, 'no element was created from the CSS');
  assert.ok(style, 'the stylesheet is still emitted');
  assert.ok(style.textContent.includes('TAKEOVER()'), 'the payload survives as inert CSS text');
  assert.ok(!style.textContent.includes('</style'), 'with no unescaped end tag left in it');

  for (const element of tpl.content.querySelectorAll('*')) {
    const handlers = [...element.attributes].map((a) => a.name).filter((n) => /^on[a-z]+$/i.test(n));
    assert.deepEqual(handlers, [], `<${element.localName}> carries ${handlers.join(', ')}`);
  }
});
