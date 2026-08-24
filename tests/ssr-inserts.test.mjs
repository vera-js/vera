/**
 * The extension points during a **server** render.
 *
 * `docs/CODE-PRINCIPLES.md` #6 makes the module system the product, and a module registers the same
 * way whether it is going to run in a browser or in Node. Every insert point therefore has to fire
 * server-side too — a module that silently does nothing there is the failure this framework has
 * already shipped once, in the other direction.
 *
 * The observers below all have **block bodies**, deliberately: a `'proxy-handler'`'s return value
 * *becomes the value read*, so `() => count++` would make every read of every store yield a number.
 * That is the point of the hook and the trap in it, and it is asserted here as well as documented.
 */
import { renderToString } from '@verajs/ssr/vera';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const dir = mkdtempSync(new URL('./.inserts-', import.meta.url).pathname);
let markup;
let observed;
try {
  writeFileSync(
    `${dir}/probe.js`,
    `import { init, render, html, createStore, insert } from '@verajs/core';
export const observed = { reads: 0, writes: 0, inits: 0, order: [], errors: [] };
insert('proxy-handler', () => { observed.reads++; }, 30);
insert('set-handler', () => { observed.writes++; }, 30);
insert('init', () => { observed.inits++; observed.order.push('init@30'); }, 30);
insert('init', () => { observed.order.push('init@70'); }, 70);
insert('error', (error) => { observed.errors.push(String(error.message)); }, 30);
customElements.define('insert-probe', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 0 });
    state.n = 1;
    render(() => html\`<p>\${state.n}</p>\`);
  }
});
export default customElements.get('insert-probe');
`
  );
  const url = new URL(`file://${dir}/probe.js`);
  ({ html: markup } = await renderToString(url));
  ({ observed } = await import(url.href));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

let pass = 0;
const failures = [];
const check = (name, condition, extra = '') => (condition ? pass++ : failures.push(`${name} — ${extra}`));

check('a proxy-handler insert sees reads', observed.reads > 0, String(observed.reads));
check('a set-handler insert sees writes', observed.writes > 0, String(observed.writes));
check('an init insert runs', observed.inits > 0, String(observed.inits));
check('init inserts run in priority order', observed.order.join(',') === 'init@30,init@70', observed.order.join(','));

/**
 * The value written before `render()` is the value rendered. An observing `'proxy-handler'` that
 * returned something would replace it — this is what that failure looks like from the outside, and
 * it is indistinguishable from the store being broken.
 */
check('an observing proxy-handler does not replace the value read', /<p>1<\/p>/.test(markup), markup);

if (failures.length) {
  console.log(`\n  ${failures.length} insert failure(s):\n`);
  for (const failure of failures) console.log('    ' + failure);
}
console.log(`ssr inserts: ${pass} checks across every extension point`);
assert.equal(failures.length, 0);
