/**
 * **`.innerHTML` and `.textContent` render on the server — the one sanctioned trusted-markup door, made to behave as
 * an `innerHTML` ASSIGNMENT rather than as parsed page markup.** The server used to serve an empty element and the
 * client filled it, which is a hydration mismatch. Now the content is written after the open tag, and the two ways a
 * served page would act where `innerHTML` does not are neutralized: a `<script>` is made inert and a
 * `<template shadowrootmode>` cannot attach a shadow root. A RAWTEXT, text-only or foreign host, and any
 * `textContent`, is escaped text; only `innerHTML` on an ordinary HTML host is live markup, and whatever it leaves
 * open is closed so it cannot reach the host's parent.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import { load } from './dist.mjs';

const serverScript = `
import { serializeTemplate, renderToString } from '@verajs/ssr';
import { html } from '@verajs/core';
const strings = (list) => Object.assign([...list], { raw: [...list] });
const tpl = (host, prop, value) => ({ ['_$litType$']: 1, strings: strings([\`<\${host} .\${prop}=\`, \`></\${host}>\`]), values: [value] });
const ROWS = ${JSON.stringify([
  ['div', 'innerHTML', '<b>hi</b>'],
  ['div', 'innerHTML', '<svg><style>.a{}'],
  ['div', 'innerHTML', '<!-- open'],
  ['div', 'innerHTML', '<img alt="a<script b">'],
  ['div', 'innerHTML', '<style>.a{}<script>x</style>'],
  ['div', 'textContent', '<b>& "q"'],
  ['style', 'textContent', '.x > .y { }'],
  ['textarea', 'innerHTML', '<b>x</b>'],
  ['title', 'textContent', '<b>t</b>'],
  ['svg', 'innerHTML', '<style>.a{}'],
])};
const out = {};
for (const [host, prop, value] of ROWS) out[host + '.' + prop + '=' + value] = serializeTemplate(tpl(host, prop, value));
const CONV = [[null], [undefined], [0], [false], [{ toString: () => 'OBJ' }]];
const conv = {};
for (const prop of ['innerHTML', 'textContent'])
  conv[prop] = CONV.map(([v]) => serializeTemplate(tpl('div', prop, v)));
const SCRIPTS = ['<script>globalThis.__ran = 1<\\/script>', '<SCRIPT>globalThis.__ran = 1<\\/SCRIPT>', '<ScRiPt>globalThis.__ran = 1<\\/ScRiPt>',
  '<script/data-x>globalThis.__ran = 1<\\/script>', '<script\\n>globalThis.__ran = 1<\\/script>', '<script type=module>globalThis.__ran = 1<\\/script>'];
const scripts = SCRIPTS.map((markup) => serializeTemplate(tpl('div', 'innerHTML', markup)));
const page = (await renderToString(new URL('./tests/fixtures/ssr/content-ssr.js', 'file://' + process.cwd() + '/'))).html;
process.stdout.write(JSON.stringify({ out, conv, page, scripts }));
`;
const served = JSON.parse(
  execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', serverScript], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
);

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];

/**
 * Through a real component render. Asserted on the served STRING, not by running it: the script sits inside the
 * component's declarative shadow root, which jsdom does not parse, so a run here could not fail — the spelling test
 * below, with its control, is the one that executes.
 */
test('a script in a component\u2019s trusted innerHTML is served inert', () => {
  assert.match(served.page, /<script type="text\/x-vera-inert">globalThis\.__contentRan/);
  assert.ok(/id="shown"/.test(served.page), 'and the surrounding markup is served');
});

test('every spelling of a script start tag is made inert — and the parse that would run it, runs nothing', () => {
  assert.equal(served.scripts.length, 6);
  for (const markup of served.scripts) {
    assert.match(markup, /<script type="text\/x-vera-inert"/i, markup);
    const win = new JSDOM(`<body>${markup}`, { runScripts: 'dangerously', virtualConsole: new VirtualConsole() }).window;
    assert.equal(win.__ran, undefined, markup);
  }
});

test('the control: the same markup NOT neutralized does run in that parse', () => {
  const win = new JSDOM('<body><div><script>globalThis.__ran = 1</script></div>', { runScripts: 'dangerously' }).window;
  assert.equal(win.__ran, 1, 'the parse can run scripts, so the silence above means something');
});

test('a declarative shadow root in trusted innerHTML is neutralized; the component\u2019s own is kept', () => {
  /** The component's OWN shadow root is legitimate declarative shadow DOM and keeps `shadowrootmode`. */
  assert.equal(served.page.match(/<template shadowrootmode=/g)?.length, 1, 'exactly the component\u2019s own');
  /** The trusted markup's template is renamed, so a parser cannot attach a shadow root from it. */
  assert.match(served.page, /<template data-vera-shadowrootmode="open"><span id="shadow">/);
});

test('a RAWTEXT, text-only or foreign host, and any textContent, is escaped text', () => {
  const body = (markup) => new JSDOM(`<body>${markup}`).window.document.body;
  assert.equal(body(served.out['div.textContent=<b>& "q"']).querySelector('b'), null);
  assert.equal(body(served.out['div.textContent=<b>& "q"']).textContent, '<b>& "q"');
  assert.equal(body(served.out['textarea.innerHTML=<b>x</b>']).querySelector('textarea').querySelector('b'), null);
  assert.equal(body(served.out['title.textContent=<b>t</b>']).querySelector('title').textContent, '<b>t</b>');
  assert.equal(body(served.out['svg.innerHTML=<style>.a{}']).querySelector('style'), null, 'svg host over-escaped, the safe side');
  assert.ok(served.out['style.textContent=.x > .y { }'].includes('.x > .y { }'), 'RAWTEXT is not entity-escaped');
});

test('innerHTML leaves nothing open that reaches the host’s parent', () => {
  for (const key of ['div.innerHTML=<svg><style>.a{}', 'div.innerHTML=<!-- open']) {
    const doc = new JSDOM(`<body>${served.out[key]}<hr id="after">`).window.document;
    const after = doc.querySelector('#after');
    assert.ok(after !== null && after.parentElement === doc.body, `${key}: the sibling after the host is not swallowed\n${served.out[key]}`);
  }
  assert.ok(!served.out['div.innerHTML=<img alt="a<script b">'].includes('type="text/x-vera-inert"'), 'a <script in an attribute value is not rewritten');
  assert.ok(!served.out['div.innerHTML=<style>.a{}<script>x</style>'].includes('type="text/x-vera-inert"'), 'nor one inside raw text');
});

test('conversion follows each property’s IDL, measured against a live setter', () => {
  const values = [null, undefined, 0, false, { toString: () => 'OBJ' }];
  for (const prop of ['innerHTML', 'textContent']) {
    for (let i = 0; i < values.length; i++) {
      const probe = document.createElement('div');
      probe[prop] = values[i];
      const servedBody = new JSDOM(`<body>${served.conv[prop][i]}`).window.document.body.firstChild;
      assert.equal(servedBody.textContent, probe.textContent, `${prop} = ${String(values[i])}`);
    }
  }
});

test('hydrating the server output adopts each host and ends exactly where a client render does', async () => {
  const { renderInto: hydrateInto } = await load('renderer/hydrate');
  const { renderInto } = await load('renderer');
  const strings = (list) => Object.assign([...list], { raw: [...list] });
  const tpl = (host, prop, value) => ({ ['_$litType$']: 1, strings: strings([`<${host} .${prop}=`, `></${host}>`]), values: [value] });
  const wrong = [];
  for (const key of Object.keys(served.out)) {
    const [, host, prop, value] = /^(\w+)\.(\w+)=([^]*)$/.exec(key);
    const container = document.createElement('div');
    container.innerHTML = served.out[key];
    const said = [];
    const warn = console.warn;
    console.warn = (m) => said.push(String(m));
    try {
      hydrateInto(tpl(host, prop, value), container);
    } finally {
      console.warn = warn;
    }
    const fresh = document.createElement('div');
    renderInto(tpl(host, prop, value), fresh);
    if (said.some((m) => /fell back/.test(m))) wrong.push(`${key}: fell back`);
    if (container.innerHTML !== fresh.innerHTML) wrong.push(`${key}: ${container.innerHTML} vs ${fresh.innerHTML}`);
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});
