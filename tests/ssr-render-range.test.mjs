/**
 * **`render()` owns its own range and nothing else**, on the server as on the client.
 *
 * Measured in a browser DOM, the client's contract is precise and holds over time: content already
 * in the container stays *before* the rendered range, a node appended afterwards stays *after* it,
 * and both survive every re-render. It is a promise, not an accident — the re-render cases are what
 * prove that.
 *
 * The server assigned `innerHTML` outright, which broke two things:
 *
 * - a component that called `render()` **and** appended to its own root kept the appended node in
 *   the browser and lost it here, so the two halves rendered different DOM;
 * - `renderToString(url, { children })` against a **light-DOM** component silently discarded the
 *   children, because they are written into the element before `connectedCallback` and the render
 *   then overwrote them. A shadow component was unaffected: its children live in the light DOM and
 *   the render goes into the shadow root.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { renderToString } from '@verajs/ssr';

/** Inside the repo: a fixture imports `@verajs/core` by bare specifier and a temp dir cannot resolve it. */
const dir = mkdtempSync(new URL('./.range-', import.meta.url).pathname);
let n = 0;
const render = async (body, options) => {
  const tag = `rng-${++n}`;
  const file = `${dir}/${tag}.js`;
  writeFileSync(
    file,
    `import { init, render, html, createStore } from '@verajs/core';\n` +
      `class C extends HTMLElement {\n  connectedCallback() {${body}}\n}\n` +
      `customElements.define('${tag}', C);\nexport default C;\n`
  );
  return (await renderToString(new URL(`file://${file}`), options)).html;
};

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a node a component appends to its own root survives', async () => {
  const html = await render(
    `init(this, { mode: 'open' });` +
      `render(() => html\`<span>R</span>\`);` +
      `const kid = document.createElement('b'); kid.textContent = 'appended';` +
      `this.shadowRoot.appendChild(kid);`
  );
  assert.match(html, /<span>R<\/span><b>appended<\/b>/, 'the appended node is kept, after the rendered range');
});

test('and a re-render updates the range without disturbing it', async () => {
  const html = await render(
    `init(this, { mode: 'open' });` +
      `const s = createStore({ n: 0 });` +
      `render(() => html\`<span>R\${s.n}</span>\`);` +
      `const kid = document.createElement('b'); kid.textContent = 'appended';` +
      `this.shadowRoot.appendChild(kid);` +
      `s.n = 1;`
  );
  assert.match(html, /<span>R1<\/span><b>appended<\/b>/, 'the range updated in place and the node stayed put');
});

test('children reach a light-DOM component and survive its render', async () => {
  const html = await render(`init(this); render(() => html\`<span>R</span>\`);`, { children: '<i>kid</i>' });
  assert.match(html, /<i>kid<\/i><span>R<\/span>/, 'children come first, the rendered range after');
});

test('a shadow component is unaffected — its children are light DOM', async () => {
  const html = await render(`init(this, { mode: 'open' }); render(() => html\`<slot></slot><span>R</span>\`);`, {
    children: '<i>kid</i>',
  });
  assert.match(html, /<template shadowrootmode="open"><slot><\/slot><span>R<\/span><\/template><i>kid<\/i>/);
});

test('a container someone rewrote wholesale starts a fresh range', async () => {
  /**
   * The bookkeeping is "what we wrote, and what was in front of it". If neither is there any more,
   * the old range is gone and the honest place for a new one is the end — where a first `render()`
   * puts it in a browser.
   */
  const html = await render(
    `init(this, { mode: 'open' });` +
      `const s = createStore({ n: 0 });` +
      `render(() => html\`<span>R\${s.n}</span>\`);` +
      `this.shadowRoot.innerHTML = '<u>replaced</u>';` +
      `s.n = 1;`
  );
  assert.match(html, /<u>replaced<\/u><span>R1<\/span>/, 'the replacement is kept and the new range follows it');
});
