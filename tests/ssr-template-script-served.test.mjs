/**
 * **An HTML `<script>` written in a template is served as written** (2026-11-26), so it runs on a server-rendered page,
 * while a page rendered in the browser never runs it: the parser marks a script it reads inside a `<template>` as already
 * started, and a clone keeps the mark (`docs/BROWSER-LEDGER.md`, 2026-11-17). The server and the client disagree on
 * whether it runs, in every renderer; it stays live here because making it inert would stop a server-rendered page's
 * scripts (an analytics snippet in a layout) from running. The difference is documented in the ssr README's Known limits
 * and in `llms.txt` (`tests/docs-limitations.test.mjs` holds the prose); this row holds the server half of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const { renderToString } = await import('@verajs/ssr');

test('a script written in a template is served byte for byte, its type untouched, beside the markup around it', async () => {
  const dir = new URL('./fixtures/ssr/generated-template-script/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(new URL('page.js', dir), `
import { init, html } from '@verajs/core';
export default class TemplateScriptPage extends HTMLElement {
  connectedCallback() {
    init({ host: this }, () => () => html\`<p>before</p><script>window.ran = 1</script><script type="module">import './app.js'</script><p>after</p>\`);
  }
}
customElements.define('template-script-page', TemplateScriptPage);
`);
    const { html } = await renderToString(new URL('page.js', dir));
    assert.match(html, /<p>before<\/p>.*<p>after<\/p>/s, 'CONTROL: the component rendered');
    assert.ok(html.includes('<p>before</p><script>window.ran = 1</script><script type="module">import \'./app.js\'</script><p>after</p>'), html);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
