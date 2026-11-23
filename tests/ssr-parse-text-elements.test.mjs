/**
 * **What the server's DOM parses as text is what every engine parses as text** (2026-11-23). The parse took its
 * raw-text list from a six-name set that lacks `xmp`, `noembed`, `noframes` and `plaintext`, so markup assigned
 * through `innerHTML` gave a query elements every engine reads as one text node — `<xmp><img src=x onerror=…></xmp>`
 * answered `querySelector('img')` with an element. Each row is compared with jsdom's parser (parse5, which the engines
 * agree with here); the control is the same markup in a `<div>`, where the elements are real on both sides.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const real = new JSDOM('<!doctype html><body></body>').window.document;
await import('@verajs/ssr');
const shim = globalThis.document;

const INNER = '<img src="x" onerror="1"><b>x</b>';
/** What a query finds after the markup is assigned, on one side. */
const found = (doc, markup) => {
  const host = doc.createElement('div');
  host.innerHTML = markup;
  return [host.querySelector('img') !== null, host.querySelector('b') !== null].join(',');
};

test('xmp, noembed, noframes and plaintext hold text, as the engines read them', () => {
  for (const name of ['xmp', 'noembed', 'noframes', 'plaintext', 'iframe', 'textarea', 'title', 'style']) {
    const markup = name === 'plaintext' ? `<${name}>${INNER}` : `<${name}>${INNER}</${name}>`;
    assert.equal(found(shim, markup), found(real, markup), `<${name}>: the server's query answers as a browser's`);
    assert.equal(found(shim, markup), 'false,false', `<${name}>: no element inside`);
  }
});

test('CONTROL: the same markup in a div is elements on both sides', () => {
  const markup = `<div>${INNER}</div>`;
  assert.equal(found(real, markup), 'true,true');
  assert.equal(found(shim, markup), 'true,true');
});

test('the text reads back as the engines read it, and the served bytes are as assigned', () => {
  for (const name of ['xmp', 'noembed', 'noframes']) {
    const host = shim.createElement('div');
    host.innerHTML = `<${name}>${INNER}</${name}>`;
    const element = host.querySelector(name);
    assert.ok(element, `CONTROL: the <${name}> itself was parsed`);
    const theirs = real.createElement('div');
    theirs.innerHTML = `<${name}>${INNER}</${name}>`;
    assert.equal(element.textContent, theirs.querySelector(name).textContent, `<${name}>: its text`);
    assert.equal(host.innerHTML, `<${name}>${INNER}</${name}>`, `<${name}>: served as assigned`);
  }
});
