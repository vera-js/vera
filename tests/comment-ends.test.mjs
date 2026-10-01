/**
 * **A comment ends where the HTML tokenizer ends it — on both sides, in every scanner.**
 *
 * The tokenizer closes a comment at `-->`, at `--!>`, and ABRUPTLY at `<!-->` and `<!--->`. Every scanner here knew only
 * `-->`, so `<p><!-->${value}</p>` read the value as inside a comment and dropped it, silently, on the client and the
 * server, while a browser renders it; and a template ending in `<!-->` had a `-->` closer appended, served as visible
 * text. Pinned per scanner: the client's, the server's template scanner, the server DOM's parser (innerHTML) and the
 * nested-component scan.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

/** `<!---->` is an ORDINARY empty comment — the abrupt close is `<!-->` and `<!--->` only, never `--` then `>`. */
const SHAPES = { abrupt: '<!-->', abruptDash: '<!--->', bang: '<!-- a --!>', empty: '<!---->' };
const strings = (list) => Object.assign([...list], { raw: [...list] });
/** A value after each shape at the top level, and a child template ENDING in each shape. */
const rows = (html) => {
  const out = {};
  for (const [name, shape] of Object.entries(SHAPES)) {
    out[`${name} then a value`] = { ['_$litType$']: 1, strings: strings([`<p>${shape}`, '</p>']), values: ['VISIBLE'] };
    out[`a child ending in ${name}`] = html`<div>${{ ['_$litType$']: 1, strings: strings([`x${shape}`]), values: [] }}<b>${'VISIBLE'}</b></div>`;
  }
  return out;
};

const serverScript = `
import { serializeTemplate, renderToString } from '@verajs/ssr';
import { html } from '@verajs/core';
const rows = (${rows.toString()});
const SHAPES = ${JSON.stringify(SHAPES)};
const strings = (${strings.toString()});
const out = {};
for (const [name, template] of Object.entries(rows(html))) out[name] = serializeTemplate(template);
const page = await renderToString(new URL('./tests/fixtures/ssr/comment-ends-ssr.js', 'file://' + process.cwd() + '/'));
process.stdout.write(JSON.stringify({ out, page: page.html }));
`;
const served = JSON.parse(
  execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', serverScript], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
);

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];
const { html } = await load('core');
const { renderInto } = await load('renderer');
const visibleText = (markup) => new JSDOM(`<body>${markup}`).window.document.body.textContent;

test('the client renders a value after every comment close, and a child ending in one adds nothing', () => {
  for (const [name, template] of Object.entries(rows(html))) {
    const host = document.createElement('div');
    renderInto(template, host);
    assert.match(host.textContent, /VISIBLE/, name);
    assert.doesNotMatch(host.textContent, /-->/, name);
  }
});

test('the server serves the same text, with no stray closer', () => {
  for (const [name, out] of Object.entries(served.out)) {
    assert.match(visibleText(out), /VISIBLE/, `${name}: ${out}`);
    assert.doesNotMatch(visibleText(out), /-->/, `${name}: ${out}`);
  }
});

test('parity: the parsed server output shows what the client renders', () => {
  for (const [name, template] of Object.entries(rows(html))) {
    const host = document.createElement('div');
    renderInto(template, host);
    assert.equal(visibleText(served.out[name]), host.textContent, name);
  }
});

test('the nested-component scan finds a component after an abrupt or --!> comment close', () => {
  assert.equal(served.page.match(/child rendered/g)?.length, 2, served.page);
});

test('the server DOM parses those closes as the browser does', () => {
  const parsed = /data-parsed="([^"]*)"/.exec(served.page)?.[1];
  const expected = document.createElement('div');
  expected.innerHTML = '<!-->a<!--->b<!-- c --!>d';
  assert.equal(parsed, [...expected.childNodes].map((node) => `${node.nodeType}:${node.nodeValue ?? node.textContent}`).join('|'));
});
