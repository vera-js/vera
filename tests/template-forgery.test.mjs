/**
 * **Only a tagged template literal is a template — data shaped like one is an ordinary object, on both sides.**
 *
 * Template detection is by shape (`strings`), so a value from `JSON.parse` — a request body, an API field an attacker
 * can turn into an object — that looked like a template was rendered as MARKUP by the client and the server alike.
 * A literal's strings array owns `raw`, which JSON cannot give an array, and an object that owns one is not an
 * array: the check Lit makes. It runs where a template is first built, which a forged array always is, so a cached
 * template pays nothing. A forgery renders as the text any object does — `[object Object]` — and never throws: it
 * is attacker-controlled, and a throw would trade the injection for the whole response.
 *
 * Each door is tried separately: a child, an array, an iterable, `hold`, a list item, an SVG type, a JSON object that
 * owns `raw`, a real template sent through JSON, the root, a textarea, and a spread-shaped object.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { DOORS, forged } from './fixtures/template-forgery.mjs';

const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
import { DOORS } from './tests/fixtures/template-forgery.mjs';
const out = {};
for (const [name, make] of Object.entries(DOORS)) {
  try { out[name] = serializeTemplate(make()); } catch (error) { out[name] = 'THREW ' + error.message; }
}
process.stdout.write(JSON.stringify(out));
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
const { renderInto } = await load('renderer');
const { renderInto: hydrateInto } = await load('renderer/hydrate');
const rendered = {};
for (const [name, make] of Object.entries(DOORS)) {
  const host = document.createElement('div');
  try {
    renderInto(make(), host);
    rendered[name] = host;
  } catch (error) {
    rendered[name] = `THREW ${error.message}`;
  }
}

const markers = (html) => html.replace(/<!--[^]*?-->|<\?[^>]*>/g, '');

test('the client renders no forgery as markup, and throws for none', () => {
  const wrong = [];
  for (const [name, host] of Object.entries(rendered)) {
    if (name === 'control' || name === 'borrowedStrings') continue;
    if (typeof host === 'string') wrong.push(`${name}: ${host}`);
    else if (host.querySelector('#pwn, [onerror]')) wrong.push(`${name}: ${host.innerHTML}`);
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});

test('the server serves no forgery as markup, and throws for none', () => {
  const wrong = [];
  for (const [name, out] of Object.entries(served)) {
    if (name === 'control' || name === 'borrowedStrings') continue;
    if (out.startsWith('THREW')) wrong.push(`${name}: ${out}`);
    else if (new JSDOM(`<body>${out}`).window.document.querySelector('#pwn, [onerror]')) wrong.push(`${name}: ${out}`);
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});

test('a forgery is the text any object renders as — the same on both sides', () => {
  for (const name of ['child', 'array', 'hold', 'roundTrip', 'svgType', 'objectOwningRaw', 'root']) {
    assert.match(served[name], /\[object Object\]/, `server, ${name}`);
    assert.match(rendered[name].textContent, /\[object Object\]/, `client, ${name}`);
    assert.equal(markers(rendered[name].innerHTML).replace(/\s+/g, ''), served[name].replace(/\s+/g, ''), `parity, ${name}`);
  }
});

test('the control: a real template still renders, through the same doors', () => {
  assert.equal(served.control, '<p><b id="ok">ok</b></p>');
  assert.ok(rendered.control.querySelector('#ok'));
  assert.equal(served.borrowedStrings, '<p><b id="ok">ok</b></p>', 'a wrapper around a literal\u2019s strings is a template');
  assert.equal(rendered.borrowedStrings.querySelector('#ok')?.textContent, 'ok');
  assert.ok(forged('x').strings.raw === undefined && Array.isArray(forged('x').strings), 'the forgery is what JSON makes');
});

test('hydrating the server\u2019s output of a forgery adopts it as the same text, and throws for none', () => {
  const wrong = [];
  for (const name of ['child', 'array', 'hold', 'svgType', 'roundTrip', 'primitiveString']) {
    const host = document.createElement('div');
    host.innerHTML = served[name];
    try {
      hydrateInto(DOORS[name](), host);
    } catch (error) {
      wrong.push(`${name}: threw ${error.message}`);
      continue;
    }
    if (host.querySelector('#pwn, [onerror]') || !/\[object Object\]/.test(host.textContent)) wrong.push(`${name}: ${host.innerHTML}`);
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});
