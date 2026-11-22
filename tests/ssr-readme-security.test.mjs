/**
 * **The `@verajs/ssr` README's Security section, example by example.** Each row is a promise that section makes in
 * words — "inside `<svg>` a `<style>` … every value is escaped", "`<a title=x title=${null}>` serves `<a>`", "a bound
 * `srcdoc` attribute … is never served" — run through the server and checked against what the browser would parse. The
 * README has no runnable recipe, so before this file nothing executed those sentences, and a change that broke one
 * would have left the documentation promising it. A row's message names the sentence it holds the server to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { serializeTemplate } from '@verajs/ssr';

const T = (type) => (statics, ...values) => ({ ['_$litType$']: type, strings: Object.assign([...statics], { raw: [...statics] }), values });
const html = T(1);
const serve = (template) => {
  try {
    return serializeTemplate(template);
  } catch (error) {
    return `THREW ${/\(([a-z-]+)\)\s*$/.exec(error.message)?.[1] ?? error.message}`;
  }
};
/** Every element the browser builds from the served markup, template contents included, scripting on. */
const elements = (markup) => {
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes ?? []) {
      if (child.tagName) out.push(child);
      walk(child);
      if (child.content) walk(child.content);
    }
  };
  walk(parse(`<!doctype html><body>${markup}`, { scriptingEnabled: true }));
  return out;
};
const made = (markup, id) => elements(markup).some((element) => element.attrs.some((a) => a.name === 'id' && a.value === id));
const attribute = (markup, tag, name) => elements(markup).find((element) => element.tagName === tag)?.attrs.find((a) => a.name === name)?.value;

const CSS = 'a > b';
const BREAK = '</style></title></xmp><img id=pwn>';
/** `[the README's words, the template, whether the served markup keeps the promise]` */
const ROWS = [
  ['`<style>` content is written raw with its own end tag neutralized', html(['<style>', '</style>'], `${CSS} ${BREAK}`), (o) => o.includes(CSS) && o.includes('<\\/style') && !made(o, 'pwn')],
  ['`<title>` and `<textarea>` decode references, so they keep ordinary escaping', html(['<title>', '</title>'], BREAK), (o) => !made(o, 'pwn')],
  ['inside `<svg>` or `<math>` a `<style>` is … markup — so inside any of them every value is escaped', html(['<svg><style>', '</style></svg>'], BREAK), (o) => !made(o, 'pwn') && !o.includes(CSS)],
  ['except inside an HTML integration point: SVG `<foreignObject>`', html(['<svg><foreignObject><style>', '</style></foreignObject></svg>'], CSS), (o) => o.includes(CSS)],
  ['(`<math><mi><mglyph>` is MathML again)', html(['<math><mi><mglyph><style>', '</style></mglyph></mi></math>'], CSS), (o) => !o.includes(CSS)],
  ['and after a tag that ENDS foreign content (`<svg><p>`)', html(['<svg><p><style>', '</style>'], CSS), (o) => o.includes(CSS)],
  ['Inside `<xmp>` … nothing is raw either', html(['<xmp>', '</xmp>'], BREAK), (o) => !made(o, 'pwn')],
  ['`<script.x>` is an unknown element, never a `<script>`', html(['<script.x>', '</script.x>'], '<img id=pwn>'), (o) => !made(o, 'pwn')],
  ['a value bound into an `on…` attribute in a template is dropped', html(['<b onclick=', '>x</b>'], 'alert(1)'), (o) => attribute(o, 'b', 'onclick') === undefined],
  ['a `<script>` in `.innerHTML` is served with an inert `type`', html(['<div .innerHTML=', '></div>'], '<script>alert(1)</script>'), (o) => attribute(o, 'script', 'type') === 'text/x-vera-inert'],
  ['a `<template shadowrootmode>` in `.innerHTML` cannot attach a shadow root', html(['<div .innerHTML=', '></div>'], '<template shadowrootmode=open><b>s</b></template>'), (o) => attribute(o, 'template', 'shadowrootmode') === undefined],
  ['a `{"strings": [...]}` from `JSON.parse` … is served as `[object Object]`', html(['<p>', '</p>'], JSON.parse('{"_$litType$":1,"strings":["<img id=pwn>"],"values":[]}')), (o) => o === '<p>[object Object]</p>'],
  ['Every bound attribute value is served double-quoted, whatever quoting the template used', html(["<b title='", "'>x</b>"], 'a"b\' c=d'), (o) => attribute(o, 'b', 'title') === 'a"b\' c=d' && attribute(o, 'b', 'c') === undefined],
  ['`<a title=x title=${null}>` serves `<a>`', html(['<a title=x title=', '>y</a>'], null), (o) => o.startsWith('<a>')],
  ['`?hidden="x${false}"` is the truthy `"xfalse"`', html(['<b ?hidden="x', '">y</b>'], false), (o) => attribute(o, 'b', 'hidden') === ''],
  ['`.value="${first} ${last}"` serves the whole name as the control\'s value', html(['<input .value="', ' ', '">'], 'Ada', 'Lovelace'), (o) => attribute(o, 'input', 'value') === 'Ada Lovelace'],
  ['A bound `javascript:` URL is never served', html(['<a href=', '>x</a>'], 'javascript:alert(1)'), (o) => attribute(o, 'a', 'href') === undefined],
  ['judged on the attribute\'s whole value, statics and character references included', html(['<a href="javascript&#58;', '">x</a>'], 'alert(1)'), (o) => attribute(o, 'a', 'href') === undefined],
  ['… statics included (`java` + a value)', html(['<a href="java', '">x</a>'], 'script:alert(1)'), (o) => attribute(o, 'a', 'href') === undefined],
  ['an SVG animation\'s `values`, item by item', html(['<svg><animate attributeName=href values="x;', '"/></svg>'], 'javascript:alert(1)'), (o) => !o.includes('javascript')],
  ['a bound `srcdoc` attribute … is never served', html(['<iframe srcdoc=', '></iframe>'], '<b>x</b>'), (o) => attribute(o, 'iframe', 'srcdoc') === undefined],
  ['a bound URL on a `<script>` (`src`) … is never served', html(['<script src=', '></script>'], '/x.js'), (o) => attribute(o, 'script', 'src') === undefined],
  ['A dynamic attribute *name* is refused', html(['<b ', '="x">y</b>'], 'title'), (o) => o === 'THREW name-expression'],
  ['The same holds for a value in TAG position', html(['<', '>y</b>'], 'b'), (o) => o === 'THREW tag-hole'],
  ['A template ending inside a tag is refused', html(['<b title="', ''], 'x'), (o) => o === 'THREW ssr-unfinished-tag'],
  ['and so is a template rendered inside a text-only element', html(['<textarea>', '</textarea>'], html(['<b>', '</b>'], 'x')), (o) => o === 'THREW ssr-template-in-text'],
];

test('every example the ssr README\'s Security section gives is what the server serves', () => {
  /** A floor, not a census: the section's examples, so an emptied table cannot pass. */
  assert.ok(ROWS.length >= 26, `the table has ${ROWS.length} rows: the scan is broken, not the server`);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const broken = ROWS.filter(([, template, keeps]) => !keeps(serve(template))).map(([words, template]) => `"${words}" -> ${serve(template)}`);
    assert.deepEqual(broken, []);
  } finally {
    console.warn = warn;
  }
});

test('CONTROLS: each kind of check finds what it looks for', () => {
  assert.equal(made('<p></p><img id=pwn>', 'pwn'), true, 'the element check finds a planted element');
  assert.equal(attribute('<a href="https://example.com">x</a>', 'a', 'href'), 'https://example.com', 'the attribute check reads a served URL');
  assert.equal(serve(html(['<p>', '</p>'], 'kept')), '<p>kept</p>', 'a plain text hole is served');
  assert.equal(serve(html(['<i class="', ''], 'x')).startsWith('THREW'), true, 'a refusal reads as THREW');
});
