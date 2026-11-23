/**
 * **A value enters a `<script>` only as a JSON data block** (Brian, 2026-11-17). On a page the server rendered, a value in
 * a script RUNS; on the client a template's script never runs (BROWSER-LEDGER). So: the server refuses a script hole in
 * every build (`ssr-script-hole`) unless the script's start tag — the one that OPENED it, read by the tokenizer, never
 * found by searching back — names a JSON type with no character reference (`dataBlock`), and writes the value with `<`
 * as `<` (a `<!--<script>` value otherwise swallows the rest of the page). The client's renderer refuses the same
 * shapes in EVERY build (`script-hole`; Brian, 2026-11-18 — a page saved from the DOM and served again runs a script).
 * Rows: the twin held equal, the rule's table, the server's output, the client's refusals, and the two sides agreeing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';
import { fsPath } from '../scripts/fs-path.mjs';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
/** A definition's text: a two-line arrow's two lines, a function's through its closing `};`, or a one-line constant's line. */
const definition = (text, name) => new RegExp(`export const ${name} = (?:\\([^)]*\\) =>\\n[^\\n]*;|\\([^]*?\\n};|[^\\n]*;)`).exec(text)?.[0];

test('the server holds an exact twin of the shared rule: dataBlock, JSON_BLOCK and closedRawText, the same text', () => {
  const shared = source('packages/shared-utils/src/markup-grammar.ts');
  const ssr = source('packages/ssr/src/vera/escaping.ts');
  for (const name of ['JSON_BLOCK', 'dataBlock', 'closedRawText']) {
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
    /** A name as the parser reads it (2026-11-23): `x"type` and `=type` are names of their own, and the script runs. */
    '<script x"type="application/json">': false, '<script =type="application/json">': false, "<script a'b type='application/json'>": true,
  };
  for (const [tag, expected] of Object.entries(cases)) assert.equal(dataBlock(tag), expected, tag);
});

const fixture = new URL('./fixtures/ssr/script-holes-ssr.js', import.meta.url);
/** The server's answer per shape, from a child process (`script-holes-serve.mjs`): what it served, or its refusal. */
const served = JSON.parse(
  execFileSync(process.execPath, [...process.execArgv, fsPath(new URL('./fixtures/ssr/script-holes-serve.mjs', import.meta.url))], { encoding: 'utf8', env: process.env }),
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

test('the client (every build): the renderer refuses the same shapes (script-hole), and the two sides agree on every one', async () => {
  const core = await load('core');
  const { renderer } = await load('renderer');
  core.wire([renderer]);
  for (const [i, [name, draw, accepted]] of SHAPES.entries()) {
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
    /**
     * A refusal, by its code: `script-hole`; or, for a hole in an ELEMENT inside an SVG script, the client's earlier
     * `foreign-raw-text` (an element in what it scans as raw text) — the same template refused either way.
     */
    const refused = said.some((line) => /\((?:script-hole|foreign-raw-text)\)|\/e\/(?:script-hole|foreign-raw-text)/.test(line));
    /**
     * The one allowance, production only: a JSON type written with a character reference (`application&#47;json`) is
     * refused by the server and by development's scan (they read the type as written), and accepted by production's
     * post-parse check, which reads it decoded — a genuine JSON block, which never runs, before or after a round trip.
     * Judging after the parse is what keeps production's refusal to +35 B (the scan form measured +261 B).
     */
    if (isProduction && /reference/.test(name)) {
      assert.equal(refused, false, `${name}: production's post-parse check reads the decoded JSON type`);
      continue;
    }
    assert.equal(refused, !accepted, `${name}: the client ${refused ? 'refused' : 'accepted'}`);
    assert.equal(refused, served[i].refused === 'ssr-script-hole', `${name}: the server and the client disagree`);
  }
});

/**
 * **The client, EVERY build: a hole in an SVG `<script>` is refused** (2026-11-18). An SVG script from a template runs in
 * Chromium and WebKit (BROWSER-LEDGER), so it is refused even with a JSON type — as an HTML script hole is refused in
 * every build unless a JSON block. Read from the DOM: no foreign script holds the value.
 */
test('the client (every build): a hole in a foreign <script> never reaches the DOM — the template is refused', async () => {
  const core = await load('core');
  const { renderer } = await load('renderer');
  core.wire([renderer]);
  const foreign = SHAPES.filter(([name]) => /svg|MathML/.test(name) && !/closed/.test(name));
  assert.ok(foreign.length >= 5, 'CONTROL: the foreign shapes are in the table');
  const saved = [console.error, console.warn];
  console.error = console.warn = () => {};
  try {
    for (const [name, draw] of foreign) {
      const tag = `shp-${SHAPES.findIndex(([n]) => n === name)}`;
      core.define(tag, () => draw);
      const element = document.body.appendChild(document.createElement(tag));
      core.flush();
      const scripts = [...element.querySelectorAll('script')].filter((s) => s.namespaceURI !== 'http://www.w3.org/1999/xhtml');
      assert.equal(scripts.some((s) => s.textContent.includes('zq') || s.textContent === '1'), false, `${name}: the value reached a foreign script`);
      element.remove();
    }
    /** CONTROL: a closed SVG script followed by a hole renders, in every build. */
    const [, draw] = SHAPES.find(([name]) => /closed/.test(name));
    core.define('shp-control', () => draw);
    const control = document.body.appendChild(document.createElement('shp-control'));
    core.flush();
    assert.equal(control.querySelector('text')?.textContent, 'ok', 'CONTROL: the template after a closed script rendered');
    control.remove();
  } finally {
    [console.error, console.warn] = saved;
  }
});

/**
 * **The server's shortcut for the written form answers exactly what `dataBlock` answers** (2026-11-20). `compile` judges
 * `<script type="…">` — nothing else in the tag, no `"` in the type — without `dataBlock`'s match (`writtenDataBlock`),
 * so the rule has a second address there; this row holds the two together through a real render, so a rule tightened
 * in the twin and not in the shortcut turns red. Planted red by making the shortcut answer `true` for every such tag.
 */
test("a script hole in the written `<script type=\"…\">` form is served exactly when dataBlock says it is a data block", async () => {
  const { dataBlock } = await import(new URL('packages/ssr/dist/vera/escaping.js', root));
  const { serializeTemplate } = await import('@verajs/ssr');
  const { html } = await import('@verajs/core');
  const types = ['application/json', 'application/ld+json', 'importmap', 'module', 'text/javascript', ' json ', 'JSON', 'x&amp;json', '', 'a>b json', 'json\t', 'speculationrules', 'text/json;x=1', 'Application/JSON '];
  let served = 0;
  let refused = 0;
  for (const type of types) {
    const tag = `<script type="${type}">`;
    const strings = Object.assign([tag, '</script>'], { raw: [tag, '</script>'] });
    let ok;
    try {
      serializeTemplate(html(strings, '1'));
      ok = true;
    } catch (error) {
      assert.match(String(error), /ssr-script-hole/, `${tag}: refused with its code`);
      ok = false;
    }
    assert.equal(ok, dataBlock(tag), `${tag}: the server ${ok ? 'served' : 'refused'} it, dataBlock says ${dataBlock(tag)}`);
    if (ok) served++;
    else refused++;
  }
  assert.ok(served > 2 && refused > 2, `CONTROL: both answers seen (${served} served, ${refused} refused)`);
});
