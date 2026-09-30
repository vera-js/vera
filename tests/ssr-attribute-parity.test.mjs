/**
 * **A bound attribute is the same attribute on the server and the client, in every position the template
 * can put it.**
 *
 * The client never has to think about quoting: it joins an attribute's statics and values and calls
 * `setAttribute`, so the tokenizer never sees a value. The server writes markup, so every bound value it
 * emits must survive the tokenizer exactly as the client's `setAttribute` would have stored it — or data
 * ends the attribute and starts another. That happened: an unquoted value with a static prefix
 * (`title=pre${x}`), two holes in one unquoted value, and a spaced `=` were streamed outside quotes, so a
 * value carrying ` onmouseover=…` became a live handler in the served page while the client rendered one
 * harmless `title`. Plain spaces split the same values into stray attributes, and a lone binding in a
 * QUOTED value served `title=""` for `null` where the client removes the attribute.
 *
 * The oracle is the client itself, in its own process (the server's DOM shim and jsdom cannot share one):
 * the same template and values rendered both ways from ONE table (`fixtures/ssr-attribute-cases.mjs`), the
 * served markup parsed by a spec parser, and every element compared by name, attribute SET and text.
 *
 * The client's rule, which the server must reproduce: a binding that is the WHOLE value removes the
 * attribute when nullish; a binding joined with statics or other bindings contributes `''` for nullish and
 * the attribute is always present; anything else is `String(value)`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { CASES, SHAPES, VALUES, template } from './fixtures/ssr-attribute-cases.mjs';

/* ── server, in its own process ─────────────────────────────────────────────────────────────── */
const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
import { CASES, template } from './tests/fixtures/ssr-attribute-cases.mjs';
process.stdout.write(JSON.stringify(CASES.map((c) => serializeTemplate(template(c)))));
`;
const served = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
);

/* ── client ─────────────────────────────────────────────────────────────────────────────────── */
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
const { renderInto } = await load('renderer');

/** Every element as `name{sorted attributes}`, then the text — attribute ORDER is not a difference. */
const shapeOf = (root) =>
  [...root.querySelectorAll('*')]
    .map((el) => `${el.localName}${JSON.stringify([...el.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => (a < b ? -1 : 1)))}`)
    .join(' ') + ` | ${JSON.stringify(root.textContent)}`;

test('the table is exercised — every shape, every value, both sides', () => {
  assert.equal(served.length, CASES.length, 'the server rendered every case');
  assert.ok(CASES.length >= Object.keys(SHAPES).length * VALUES.length + 6, `only ${CASES.length} cases`);
});

test('every bound attribute reads back identically from the served markup and the client DOM', () => {
  const wrong = [];
  CASES.forEach((c, i) => {
    const host = document.createElement('div');
    renderInto(template(c), host);
    const parsed = document.createElement('div');
    parsed.innerHTML = served[i];
    const client = shapeOf(host);
    const server = shapeOf(parsed);
    if (client !== server) wrong.push(`${c.label}\n      client ${client}\n      server ${server}\n      served ${served[i]}`);
  });
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});

test('the control: a payload written as markup DOES become a handler, so the comparison can see one', () => {
  const parsed = document.createElement('div');
  parsed.innerHTML = '<p title=pre onmouseover=alert(1) x=>t</p>';
  assert.equal(parsed.querySelector('p').getAttribute('onmouseover'), 'alert(1)');
});
