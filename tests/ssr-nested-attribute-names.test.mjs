/**
 * **A nested component is rebuilt from the open tag this package wrote, so the rebuild's grammar
 * must accept every name the writer can emit.**
 *
 * `index.js` re-parses that open tag to reconstruct the child instance. It kept its own attribute
 * grammar with a `[\w:-]+` name charset, narrower than what a start tag may carry — and a narrower
 * charset does not REJECT a name it cannot spell, it MIS-PARSES it: `data-a.b="v"` came back as
 * `data-a=""` plus `b="v"`, so the child was rebuilt with attributes nobody wrote and read `null`
 * for the one that was. Server-side only, silently (arc-2 run 2).
 *
 * Every name here is one real engines accept — the repo's conventions record that `a(b)`, `a|b`
 * and `a?b` are all valid and that only `a b`, `a>b`, `a=b` and `a/b` are refused. The grammar now
 * comes from `parse.js`, which owns it; this is the test that keeps the two spellings one fact.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { renderToString } from '@verajs/ssr';

const dir = new URL('./fixtures/ssr/generated-attr-names/', import.meta.url);
mkdirSync(dir, { recursive: true });

const NAMES = ['data-a.b', 'data-a(b)', 'data-a|b', 'data-a?b', 'data-plain', 'data-a:b', 'data-a-b'];

test('every attribute name an engine accepts survives the nested-component rebuild', async () => {
  for (const [i, name] of NAMES.entries()) {
    const child = new URL(`child-${i}.js`, dir);
    const parent = new URL(`parent-${i}.js`, dir);
    writeFileSync(child, `
import { init, render, html } from '@verajs/core';
customElements.define('attr-child-${i}', class extends HTMLElement {
  connectedCallback() { init(this); render(() => html\`<i>\${this.getAttribute(${JSON.stringify(name)}) ?? 'MISSING'}</i>\`); }
});
`);
    writeFileSync(parent, `
import { init, render, html } from '@verajs/core';
import './child-${i}.js';
export default class P extends HTMLElement {
  connectedCallback() { init(this); render(() => html\`<div><attr-child-${i} ${name}="VALUE"></attr-child-${i}></div>\`); }
}
customElements.define('attr-parent-${i}', P);
`);
    const { html: markup } = await renderToString(parent);
    assert.ok(markup.includes('>VALUE<'), `${name}: the child read its own attribute (got ${markup})`);
    assert.ok(!markup.includes('MISSING'), `${name}: the child saw the attribute at all`);
    assert.ok(markup.includes(`${name}="VALUE"`), `${name}: the name reached the markup unsplit`);
  }
  rmSync(dir, { recursive: true, force: true });
});
