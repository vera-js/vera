/**
 * **A value enters a `<script>` only as a JSON data block** (Brian, 2026-11-17). On a page the server rendered, a value in
 * a script RUNS; on the client a template's script never runs (BROWSER-LEDGER). So: the server refuses a script hole in
 * every build (`ssr-script-hole`) unless the script's start tag — the one that OPENED it, read by the tokenizer, never
 * found by searching back — names a JSON type with no character reference (`dataBlock`), and writes the value with `<`
 * as `<` (a `<!--<script>` value otherwise swallows the rest of the page). The client's renderer refuses the same
 * shapes in DEVELOPMENT (`script-hole`); production carries nothing (a client script hole is dead text).
 * Rows: the twin held equal, the rule's table, the server's output, the client's refusals, and the two sides agreeing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
/** A definition's text: a function's through its closing `};`, or a one-line constant's line. */
const definition = (text, name) => new RegExp(`export const ${name} = (?:\\([^]*?\\n};|[^\\n]*;)`).exec(text)?.[0];

test('the server holds an exact twin of the shared rule: dataBlock and JSON_BLOCK, the same text', () => {
  const shared = source('packages/shared-utils/src/markup-grammar.ts');
  const ssr = source('packages/ssr/src/vera/escaping.ts');
  for (const name of ['JSON_BLOCK', 'dataBlock']) {
    assert.ok(definition(shared, name), `CONTROL: ${name} found in shared-utils`);
    assert.equal(definition(ssr, name), definition(shared, name), `${name}: the twin differs`);
  }
});

test('the rule, on start tags as written: the first type, read in attribute order, no reference, ending in json', async () => {
  const { dataBlock } = await import(new URL('packages/ssr/dist/vera/escaping.js', root));
  const cases = {
    '<script type="application/json">': true, "<script type='application/ld+json'>": true, '<script type=application/json>': true,
    '<script TYPE="Application/JSON">': true, '<script type="text/javascript; x=json">': true, '<script/type="application/json">': true,
    '<script type="application/json" type="text/javascript">': true, '<script type="text/javascript" type="application/json">': false,
    '<script>': false, '<script type="">': false, '<script type>': false, '<script type="module">': false,
    '<script type="application&#47;json">': false, '<script data-x=" type=application/json">': false, '<script data-x=">" type="application/json">': true,
  };
  for (const [tag, expected] of Object.entries(cases)) assert.equal(dataBlock(tag), expected, tag);
});

const fixture = new URL('./fixtures/ssr/script-holes-ssr.js', import.meta.url);
/** The server's answer per shape, from a child process (`script-holes-serve.mjs`): what it served, or its refusal. */
const served = JSON.parse(
  execFileSync(process.execPath, [...process.execArgv, new URL('./fixtures/ssr/script-holes-serve.mjs', import.meta.url).pathname], { encoding: 'utf8', env: process.env }),
);
const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CSSStyleSheet'])
  globalThis[key] = dom.window[key];
const { SHAPES } = await import(fixture);

test('the server: a JSON data block is served with `<` as \\u003c; every other script hole is refused (ssr-script-hole), in every build', () => {
  SHAPES.forEach(([name, , accepted], i) => {
    if (accepted) {
      assert.ok(served[i].html, `${name}: served (${served[i].refused ?? ''})`);
      const text = new JSDOM(`<!doctype html><body>${served[i].html}`).window.document.querySelector('script').textContent;
      assert.equal(text.includes('<'), false, `${name}: no < left in the served block`);
    } else assert.equal(served[i].refused, 'ssr-script-hole', `${name}: refused, coded`);
  });
  const json = new JSDOM(`<!doctype html><body>${served[0].html}<p id="after"></p>`).window.document;
  assert.equal(JSON.parse(json.querySelector('script').textContent).a, '<!--<script></script>', 'the value round-trips');
});

test('the client (development): the renderer refuses the same shapes (script-hole), and the two sides agree on every one', { skip: isProduction && 'a development diagnostic: production carries nothing (a client script hole is dead text)' }, async () => {
  const core = await load('core');
  const { renderer } = await load('renderer');
  core.wire([renderer]);
  SHAPES.forEach(([name, draw, accepted], i) => {
    const said = [];
    const saved = [console.error, console.warn];
    console.error = console.warn = (...args) => said.push(args.map(String).join(' '));
    try {
      const tag = `shc-${i}`;
      core.define(tag, () => draw);
      document.body.append(document.createElement(tag));
      core.flush();
    } finally {
      [console.error, console.warn] = saved;
    }
    const refused = said.some((line) => line.includes('(script-hole)'));
    assert.equal(refused, !accepted, `${name}: the client ${refused ? 'refused' : 'accepted'}`);
    assert.equal(refused, served[i].refused === 'ssr-script-hole', `${name}: the server and the client disagree`);
  });
});
