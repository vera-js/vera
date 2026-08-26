/**
 * **A name in HTML is case-insensitive, and every decision the server DOM makes on one was not.**
 *
 * Three separate places folded nothing, and all three produced a server render that disagreed with
 * the browser the markup was about to be handed to:
 *
 * - `setAttribute('Data-Flag', …)` stored a *second* attribute, so the `getAttribute('data-flag')`
 *   beside it read `null` on the server and `'1'` in the browser.
 * - an attribute handed in as `{ 'User-ID': … }` never matched the `observedAttributes` entry
 *   `user-id`, so `attributeChangedCallback` simply did not fire — silently, since nothing about a
 *   callback that does not run is observable from the outside.
 * - the nested-component scan's tag pattern required a lower-case first letter, so `<MY-COMP>`
 *   matched *nothing* and fell through as inert text. That took every guard keyed on the name with
 *   it: an upper-case `<SCRIPT>` or `<TEXTAREA>` lost its raw-text protection and a component named
 *   inside one was rendered into its source, and `<TEMPLATE>` lost its skip.
 *
 * What must *not* fold is the other half of the rule: an element outside the HTML namespace keeps
 * its case, so `svg.setAttribute('viewBox', …)` has to survive with its capital B or the viewport
 * is ignored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { renderToString } from '@verajs/ssr/vera';

/** Inside the repo: a fixture imports `@verajs/core` by bare specifier and a temp dir cannot resolve it. */
const dir = mkdtempSync(new URL('./.casing-', import.meta.url).pathname);
let n = 0;
const render = async (body, options) => {
  const tag = `nc-${++n}`;
  const file = `${dir}/${tag}.js`;
  writeFileSync(
    file,
    `class C extends HTMLElement {\n  static observedAttributes = ['user-id'];\n  attributeChangedCallback(name, previous, value) { this.seen = (this.seen ?? '') + name + '=' + value + ';'; }\n  connectedCallback() {${body}}\n}\ncustomElements.define('${tag}', C);\nexport default C;\n`
  );
  return (await renderToString(new URL(`file://${file}`), options)).html;
};

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('setAttribute folds the name, so a set and a read of different case are one attribute', async () => {
  const html = await render(`this.setAttribute('Data-Flag', '1'); this.textContent = String(this.getAttribute('data-flag'));`);
  assert.match(html, /data-flag="1"/);
  assert.doesNotMatch(html, /Data-Flag/);
  assert.match(html, />1</);
});

test('hasAttribute, removeAttribute and toggleAttribute fold too', async () => {
  const html = await render(
    `this.setAttribute('one', '1'); this.removeAttribute('ONE');` +
      `this.toggleAttribute('TWO', true);` +
      `this.setAttribute('three', '3'); this.textContent = String(this.hasAttribute('THREE'));`
  );
  assert.doesNotMatch(html, /one=/i);
  assert.match(html, / two=""/);
  assert.match(html, />true</);
});

test('an attribute handed in with different case still fires attributeChangedCallback', async () => {
  for (const attributes of [{ 'user-id': '7' }, { 'User-ID': '7' }]) {
    const html = await render(`this.textContent = this.seen ?? 'none';`, { attributes });
    assert.match(html, /user-id="7"/, `${JSON.stringify(attributes)} reached the markup folded`);
    assert.match(html, />user-id=7;</, `${JSON.stringify(attributes)} fired the callback`);
  }
});

test('createElement folds the tag name, and createElementNS outside HTML does not', async () => {
  const html = await render(
    `this.appendChild(document.createElement('DIV'));` +
      `const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');` +
      `svg.setAttribute('viewBox', '0 0 1 1');` +
      `this.appendChild(svg);`
  );
  assert.match(html, /<div><\/div>/);
  assert.match(html, /viewBox="0 0 1 1"/, 'an SVG attribute keeps its case');
});

test('a component written in upper case is still rendered', async () => {
  const kid = `${dir}/casing-kid.js`;
  writeFileSync(kid, `class K extends HTMLElement { connectedCallback() { this.textContent = 'KID'; } }\ncustomElements.define('casing-kid', K);\nexport default K;\n`);
  const html = await render(`this.innerHTML = '<CASING-KID></CASING-KID>';`).catch((error) => error);
  assert.match(String(html), /KID/);
});

test('an upper-case raw-text element keeps its contents as text', async () => {
  const html = await render(`this.innerHTML = '<TEXTAREA><casing-kid></casing-kid></TEXTAREA>';`);
  assert.doesNotMatch(html, /KID/, 'a tag inside a textarea is its value, not an element');
});

test('a component inside an upper-case template is left for the client to upgrade', async () => {
  const html = await render(`this.innerHTML = '<TEMPLATE><casing-kid></casing-kid></TEMPLATE>';`);
  assert.doesNotMatch(html, /KID/, 'a template is a blueprint; its contents are never upgraded');
});
