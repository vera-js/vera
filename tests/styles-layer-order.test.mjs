/**
 * **A light component's defaults sit in `@layer vera` in the document, and nothing is inserted to place them**
 * (2026-11-26). In the document every light block is `@layer vera { … }`, so unlayered author CSS beats a component's
 * default; a page using a layered framework states `@layer theme, base, vera, components, utilities;` first, and
 * `@verajs/ssr` serves that statement first in a render's `styles`, so a server-rendered page needs no setup. A shadow
 * root's block is the block alone, exactly as before. jsdom holds the DOM half (which text goes where, that `<head>` gets
 * no element of ours, the server's `styles`); the cascade itself and the development warning are read in real engines
 * (`tests/browser/styles-layer-order.test.js`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { distUrl } from './dist.mjs';

const ORDER = '@layer theme, base, vera, components, utilities;';
const { applyStyles } = await import(distUrl('styles'));

/** A fresh document with `head` markup, and a light element of a new class in it. */
let classes = 0;
const page = (head = '') => new JSDOM(`<!doctype html><html><head>${head}</head><body></body></html>`).window;
const light = (win, container = win.document.body) => {
  const Class = class extends win.HTMLElement {};
  win.customElements.define(`x-layer-${++classes}`, Class);
  const element = new Class();
  container.append(element);
  return element;
};

test("the document's block is wrapped in @layer vera, and <head> gets nothing else of ours (no order line, no marker)", () => {
  const win = page('<link rel="icon" href="data:,">');
  applyStyles('.a { color: red }', light(win));
  applyStyles('.b { color: blue }', light(win));
  const styles = [...win.document.head.querySelectorAll('style')];
  assert.equal(styles.length, 2, 'CONTROL: both classes hoisted (jsdom: the <style> fallback, unscoped)');
  assert.deepEqual(styles.map((style) => style.textContent), ['@layer vera {\n.a { color: red }\n}', '@layer vera {\n.b { color: blue }\n}']);
  assert.equal(win.document.head.firstElementChild.localName, 'link', "the page's own first element stays first");
  assert.equal(win.document.head.querySelector('[data-vm-sheet]'), null, 'no element of ours carries a marker');
});

test("a shadow root's block is the block alone, as before: no layer there", () => {
  const win = page();
  const host = win.document.createElement('div');
  win.document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  applyStyles('.a { color: red }', light(win, root));
  const blocks = [...root.querySelectorAll('style')].map((style) => style.textContent);
  assert.deepEqual(blocks, ['.a { color: red }'], 'the root holds the unwrapped block');
  assert.equal(win.document.head.querySelectorAll('style').length, 0, 'and <head> nothing');
});

/** The server half, through real renders of generated components (a light page, and a shell holding a light child). */
const fixtures = new URL('./fixtures/ssr/generated-layer-order/', import.meta.url);
const serve = async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(fixtures, { recursive: true });
  const head = `import { define, html } from '@verajs/core';\nimport { css } from '@verajs/styles';\n`;
  writeFileSync(new URL('light.js', fixtures), `${head}
export default define({ tag: 'x-layer-light', styles: css\`.a { color: red; }\` }, () => () => html\`<b class="a">x</b>\`);
`);
  /** The shell's light child is a class of its own, rendered only inside the shell's root, so the page has no document CSS. */
  writeFileSync(new URL('shell.js', fixtures), `${head}
define({ tag: 'x-layer-inner', styles: css\`.n { color: green; }\` }, () => () => html\`<b class="n">n</b>\`);
export default define({ tag: 'x-layer-shell', shadow: 'open', styles: css\`i { color: blue; }\` }, () => () => html\`<i>s</i><x-layer-inner></x-layer-inner>\`);
`);
  const { renderToString } = await import('@verajs/ssr');
  return renderToString;
};
/** `LAYER_ORDER` as each package's source declares it: the twin the two must keep equal. */
const declared = (path) => readFileSync(new URL(`../packages/${path}`, import.meta.url), 'utf8').match(/const LAYER_ORDER = '([^']*)';/)?.[1];

test("a render's styles opens with the layer order, once, the same text @verajs/styles declares (the twin), and is empty for a page with no document CSS", async (t) => {
  const { rmSync } = await import('node:fs');
  t.after(() => rmSync(fixtures, { recursive: true, force: true }));
  assert.deepEqual([declared('styles/src/styles.ts'), declared('ssr/src/vera/stylesheets.ts')], [ORDER, ORDER], 'the twin: one text in both packages');
  const renderToString = await serve();
  const lightPage = await renderToString(new URL('light.js', fixtures));
  assert.match(lightPage.html, /<b class="a">x<\/b>/, 'CONTROL: the light component rendered');
  const [first, ...rest] = lightPage.styles.split('\n');
  assert.equal(first, ORDER, 'the order first');
  assert.equal(lightPage.styles.split(ORDER).length - 1, 1, 'once');
  assert.match(rest.join('\n'), /^@layer vera \{\n@scope \(x-layer-light\) \{/, 'then the light block, wrapped');

  const shellPage = await renderToString(new URL('shell.js', fixtures));
  assert.equal(shellPage.styles, '', 'a page whose only light child is inside a shadow root returns no document CSS, and no order');
  const sheets = [...shellPage.html.matchAll(/<style data-vm-sheet="(\w+)">([^<]*)<\/style>/g)].map(([, kind, text]) => [kind, text]);
  assert.deepEqual(sheets.map(([kind]) => kind), ['styles', 'light'], "the served root as before: the shell's own sheet, then the light block");
  assert.ok(sheets[1][1].startsWith('@scope (x-layer-inner) {'), `the root's block unwrapped: ${sheets[1][1]}`);
});
