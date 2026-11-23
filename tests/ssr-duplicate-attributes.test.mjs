/**
 * **A repeated attribute is its FIRST occurrence, as every parser keeps it** (2026-11-23). HTML's tokenizer drops a
 * repeated name, so `<a href="javascript:…" href="/safe">` is a `javascript:` link in a browser. The server's DOM kept
 * the last — `getAttribute('href')` answered `/safe` while the bytes it served navigated to the first — and a nested
 * component rebuilt from `<x title="first" TITLE="second">` read and served `second`. Each row is compared with jsdom's
 * parser (parse5), which the engines agree with on this rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const real = new JSDOM('<!doctype html><body></body>').window.document;
const { renderToString } = await import('@verajs/ssr');
const shim = globalThis.document;

const read = (doc, markup, selector, name) => {
  const host = doc.createElement('div');
  host.innerHTML = markup;
  return host.querySelector(selector)?.getAttribute(name);
};

test('the DOM reads the first of a repeated attribute, as the parser does', () => {
  const ROWS = [
    ['<a href="javascript:alert(1)" href="/safe">x</a>', 'a', 'href'],
    ['<p title="first" TITLE="second">x</p>', 'p', 'title'],
    ["<p data-k='1' data-k=2 data-K=\"3\">x</p>", 'p', 'data-k'],
    ['<svg><g viewBox="0 0 1 1" viewbox="9 9 9 9"></g></svg>', 'g', 'viewBox'],
  ];
  for (const [markup, selector, name] of ROWS) {
    const theirs = read(real, markup, selector, name);
    assert.ok(theirs !== undefined && theirs !== null, `CONTROL: the parser read ${name} in ${markup}`);
    assert.equal(read(shim, markup, selector, name), theirs, markup);
  }
});

test('a nested component reads and serves the first of a repeated attribute', async () => {
  const dir = new URL('./fixtures/ssr/generated-dup-attrs/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(new URL('child.js', dir), `
import { init, html } from '@verajs/core';
customElements.define('dup-kid', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html\`<i>\${this.getAttribute('title')}</i>\`); }
});
`);
    writeFileSync(new URL('parent.js', dir), `
import { init, html } from '@verajs/core';
import './child.js';
export default class P extends HTMLElement {
  connectedCallback() { init(this, () => () => html\`<div><dup-kid title="first" TITLE="second"></dup-kid></div>\`); }
}
customElements.define('dup-parent', P);
`);
    const { html: markup } = await renderToString(new URL('parent.js', dir));
    assert.ok(markup.includes('<i>first</i>'), `the child read the first (${markup})`);
    const holder = real.createElement('div');
    holder.innerHTML = markup;
    assert.equal(holder.querySelector('dup-kid')?.getAttribute('title'), 'first', `served: ${markup}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
