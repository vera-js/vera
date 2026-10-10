/**
 * **A DOM node at a child position: the server writes nothing, and hydration keeps everything around it** (2026-10-09).
 *
 * The client inserts a node as itself, and the hydration contract is that the server rendered nothing for it — "the one
 * thing the server cannot have rendered" (renderer README). tests/hydrate.test.mjs row 6 pins the CLIENT half with
 * hand-written server markup, which is why it never saw the server: ssr serialized the value as `String(value)`,
 * `[object EventTarget]`, into the page, and the client then refused that text as markup the template does not
 * describe — junk on the static page and the whole container's adoption discarded. This runs the REAL server
 * (`serializeTemplate`, in its own process, as hydrate.test does) for an element, a text node and a fragment, and
 * hydrates its output on a client holding the same kind of node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { hydrating } from './hydration.mjs';

const KINDS = {
  element: "(() => { const node = document.createElement('span'); node.textContent = 'client'; return node; })()",
  text: "document.createTextNode('client')",
  fragment: "(() => { const node = document.createDocumentFragment(); node.append('cli', 'ent'); return node; })()",
};

const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
const { html } = await import('@verajs/core');
const draw = (value) => html\`<p>server\${value}</p><i>after</i>\`;
process.stdout.write(JSON.stringify({ ${Object.entries(KINDS).map(([kind, make]) => `${kind}: serializeTemplate(draw(${make}))`).join(', ')} }));
`;
const served = JSON.parse(execFileSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', serverScript], {
  cwd: new URL('..', import.meta.url), encoding: 'utf8',
}));

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
const renderInto = await hydrating();
const html = (strings, ...values) => ({ strings, values });
/** One call site for both renders, so it is one template (CLAUDE.md: two literals are two templates). */
const draw = (value) => html`<p>server${value}</p><i>after</i>`;
const client = {
  element: () => Object.assign(dom.window.document.createElement('span'), { textContent: 'client' }),
  text: () => dom.window.document.createTextNode('client'),
  fragment: () => {
    const node = dom.window.document.createDocumentFragment();
    node.append('cli', 'ent');
    return node;
  },
};

for (const kind of Object.keys(KINDS))
  test(`a ${kind} value: the server writes nothing for it, and the client adopts the rest`, () => {
    assert.equal(served[kind], '<p>server</p><i>after</i>', `the server's markup: ${served[kind]}`);
    const host = dom.window.document.createElement('div');
    host.innerHTML = served[kind];
    const serverP = host.querySelector('p');
    const serverI = host.querySelector('i');
    const warned = [];
    const warn = console.warn;
    console.warn = (...args) => warned.push(args.map(String).join(' '));
    try {
      renderInto(draw(client[kind]()), host);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(warned, [], 'no hydration fallback');
    assert.ok(host.querySelector('p') === serverP && host.querySelector('i') === serverI, 'the server elements were adopted, not rebuilt');
    assert.equal(host.textContent, 'serverclientafter', 'and the client node is in place');
  });
