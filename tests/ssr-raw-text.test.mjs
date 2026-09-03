/**
 * RAWTEXT content, server-side — found in the 2026-08-25 full-framework audit.
 *
 * A browser does not decode a character reference inside `<style>` or `<script>`, so escaping their
 * content protects nothing and corrupts it. Interpolating `.a > .b` into a stylesheet served
 * `.a &#62; .b` — a selector matching nothing — while the client, which sets text through the DOM
 * and never re-parses, rendered it correctly: every interpolated stylesheet was broken on the server
 * and right in the browser, which is a hydration divergence as well as a visible styling bug.
 *
 * Not escaping means the element's own end tag has to come out of the value instead.
 *
 * `<title>` and `<textarea>` are **RCDATA**, not RAWTEXT — references *are* decoded there — so they
 * keep ordinary escaping, and this file pins that difference in both directions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderToString } from '../packages/ssr/src/vera/index.js';

const dir = mkdtempSync(join(process.cwd(), 'tests', '.raw-'));
const component = (body) => {
  const file = join(dir, `c${Math.abs(body.length)}-${Date.now()}-${Math.floor(performance.now() * 1000)}.js`);
  writeFileSync(
    file,
    `import { init, render, html } from '@verajs/core';\n` +
      `export default class C extends HTMLElement {\n` +
      `  connectedCallback() {\n` +
      `    init(this, { mode: 'open' });\n` +
      `    const v = this.getAttribute('v') ?? '';\n` +
      `    render(() => html\`${body}\`);\n` +
      `  }\n` +
      `}\n` +
      `customElements.define('c-${Math.abs(body.length)}-${process.hrtime.bigint()}', C);\n`
  );
  return new URL(`file://${file}`);
};

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a stylesheet interpolation is written raw, exactly as the client writes it', async () => {
  const { html } = await renderToString(component('<style>${v} { color: red }</style>'), {
    attributes: { v: '.a > .b' },
  });
  const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
  assert.equal(css, '.a > .b { color: red }', 'no character references in CSS');
  assert.doesNotMatch(css, /&#/, 'a `>` in a selector must survive');
});

test('a script interpolation is written raw', async () => {
  const { html } = await renderToString(component('<script>${v}</script>'), {
    attributes: { v: 'if (a < b && c > d) go();' },
  });
  assert.match(html, /if \(a < b && c > d\) go\(\);/, 'JavaScript must not be entity-encoded');
});

/* ── and the end tag still cannot be written ─────────────────────────────────────────────────── */

const PAYLOADS = [
  '</style><script>alert(1)</script>',
  '</script><img src=x onerror=alert(1)>',
  '</STYLE ><img src=x onerror=alert(1)>',
  '</script  ><img src=x onerror=alert(1)>',
  '</title><img src=x onerror=alert(1)>',
  '</textarea><img src=x onerror=alert(1)>',
  '</p><img src=x onerror=alert(1)>',
];

test('no payload escapes the element it was interpolated into', async () => {
  const source = component(
    '<style>${v}</style><script>${v}</script><title>${v}</title><textarea>${v}</textarea><p>${v}</p>'
  );
  for (const v of PAYLOADS) {
    const { html } = await renderToString(source, { attributes: { v } });
    const parsed = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
    assert.equal(parsed.querySelectorAll('img[onerror]').length, 0, `img injected by ${v}`);
    const escaped = [...parsed.querySelectorAll('script')].filter(
      (element) => element.textContent.includes('alert(1)') && element.parentElement?.localName !== 'style'
    );
    assert.equal(escaped.length, 0, `script injected by ${v}`);
  }
});

/** RCDATA keeps escaping, which is what the client produces for those two as well. */
test('title and textarea are still escaped', async () => {
  const { html } = await renderToString(component('<title>${v}</title><textarea>${v}</textarea>'), {
    attributes: { v: 'a > b & c' },
  });
  assert.doesNotMatch(html, /<title>a > b & c<\/title>/, 'RCDATA must not be written raw');
  assert.match(html, /<title>a &#62; b &#38; c<\/title>/);
  assert.match(html, /<textarea>a &#62; b &#38; c<\/textarea>/);
});

/** A self-closing or immediately-closed raw element must not swallow what follows. */
test('an empty style element does not make the rest of the template raw', async () => {
  const { html } = await renderToString(component('<style></style><p>${v}</p>'), {
    attributes: { v: '<img src=x onerror=alert(1)>' },
  });
  const parsed = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  assert.equal(parsed.querySelectorAll('img[onerror]').length, 0);
  assert.match(html, /&#60;img/, 'ordinary child text is still escaped');
});

/**
 * **A `<template>` ends at ITS close tag, not at the first tag whose name starts the same way.**
 *
 * The scanner skips a `<template>` whole — its content is a blueprint the client's parser never
 * upgrades, so rendering components inside it produces markup the client would never produce. The
 * depth counter that finds the end matched `<template` as a prefix, so `<templates>` counted as a
 * nested template open. Balanced, the miscount cancels and nothing shows; unbalanced, the depth
 * never returns to zero and the skip swallows **the entire rest of the document** — every component
 * after it silently not rendered, with no error anywhere.
 *
 * Found generalising this search so component tags could use it too.
 */
test('a tag whose name merely starts with "template" does not extend the skip', async () => {
  const file = join(dir, 'template-boundary.js');
  writeFileSync(
    file,
    `import { init, render, html } from '@verajs/core';\n` +
      `class After extends HTMLElement {\n` +
      `  connectedCallback() { init(this, { mode: 'open' }); render(() => html\`<i>RENDERED</i>\`); }\n` +
      `}\n` +
      `customElements.define('tpl-after', After);\n` +
      `export default class Host extends HTMLElement {\n` +
      `  connectedCallback() {\n` +
      `    init(this, { mode: 'open' });\n` +
      /** Unbalanced on purpose: `<templates>` never closes. */
      `    render(() => html\`<template><templates></template><tpl-after></tpl-after>\`);\n` +
      `  }\n` +
      `}\n` +
      `customElements.define('tpl-host', Host);\n`
  );
  const { html } = await renderToString(new URL(`file://${file}`));
  assert.match(html, /<i>RENDERED<\/i>/, 'the component AFTER the template still rendered');
  assert.match(html, /<templates>/, 'and the stray tag is left exactly as written');
});
