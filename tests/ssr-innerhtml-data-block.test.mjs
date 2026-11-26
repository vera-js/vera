/**
 * **A JSON data block in `.innerHTML` markup keeps its type on the server** (2026-11-26). The binding serves trusted
 * markup as an assignment runs it: a `<script>` in it gets an inert type written first, so the served page never runs
 * what the client's assignment would not. A data block never runs anywhere, so that edit made it inert for no reason and
 * replaced the `type` a reader finds it by (`script[type="application/json"]`). Now a start tag that `dataBlock` reads
 * as a JSON block (its first `type`, in attribute order, ending in `json`, with no `&`) is served as written, and every
 * other script as before.
 *
 * Each row serves a template through `serializeTemplate` and parses it with jsdom's parser (`new JSDOM`, never this
 * process's globals, which `@verajs/ssr` owns).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { serializeTemplate } = await import('@verajs/ssr');

const literal = (strings) => Object.freeze(Object.assign([...strings], { raw: [...strings] }));
const BOUND = literal(['<div .innerHTML=', '></div>']);
const serve = (markup) => serializeTemplate({ _$litType$: 1, strings: BOUND, values: [markup] });
/** The served scripts' `type`, as a browser reads them from the page. */
const types = (markup) => [...new JSDOM(`<!doctype html><body>${serve(markup)}</body>`).window.document.querySelectorAll('script')].map((s) => s.getAttribute('type'));
const INERT = 'text/x-vera-inert';

test('CONTROL: a script in bound markup is served inert, as before', () => {
  assert.deepEqual(types('<script>alert(1)</script>'), [INERT]);
});

test('a JSON data block keeps its type, written as it was; the script beside it is inert', () => {
  const markup = '<script type="application/json">{"a":1}</script><script>alert(1)</script>';
  assert.deepEqual(types(markup), ['application/json', INERT]);
  assert.ok(serve(markup).includes('<script type="application/json">{"a":1}</script>'), 'the block is served byte for byte');
});

test('every spelling dataBlock reads as JSON keeps its type; every other script stays inert', () => {
  const rows = [
    ['<script type="application/ld+json">{}</script>', ['application/ld+json']],
    ["<script type='importmap+json' id=x>{}</script>", ['importmap+json']],
    ['<script TYPE=application/json>{}</script>', ['application/json']],
    ['<script id="d" type="text/json" nonce="n">{}</script>', ['text/json']],
    ['<svg><script type="application/json">{}</script></svg>', ['application/json']],
    ['<script type="application/json&#x20;">alert(1)</script>', [INERT]],
    ['<script type="text/javascript" type="application/json">alert(1)</script>', [INERT]],
    ['<script type="module">alert(1)</script>', [INERT]],
    ['<script type="importmap">{}</script>', [INERT]],
    ['<script type="text/template"><b>x</b></script>', [INERT]],
    ['<script typex="application/json">alert(1)</script>', [INERT]],
  ];
  const wrong = [];
  for (const [markup, want] of rows) {
    const got = types(markup);
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${markup}: ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  }
  assert.deepEqual(wrong, []);
});

test('a data block in the template\'s own markup is unchanged', () => {
  const PAGE = literal(['<script type="application/json">{"b":2}</script><p>', '</p>']);
  assert.equal(serializeTemplate({ _$litType$: 1, strings: PAGE, values: ['x'] }), '<script type="application/json">{"b":2}</script><p>x</p>');
});

test('the written fast path changes no answer: opensDataBlock (and dataBlock) say true for both of its tags', async () => {
  const { WRITTEN_BLOCKS } = await import('../packages/ssr/dist/vera/tokenizer.js');
  const { opensDataBlock, dataBlock } = await import('../packages/ssr/dist/vera/escaping.js');
  assert.equal(WRITTEN_BLOCKS.length, 2, 'the list this row holds');
  for (const tag of WRITTEN_BLOCKS) {
    assert.equal(opensDataBlock(tag), true, tag);
    assert.equal(dataBlock(tag), true, tag);
    assert.deepEqual(types(`${tag}{}</script>`), [tag.slice(14, -2)], `served with its type: ${tag}`);
  }
  /** CONTROL: a near miss is not on the fast path and is still judged: a module stays inert, an extra attribute keeps the type. */
  assert.deepEqual(types('<script type="application/json" id=a>{}</script><script type="application/jsonx">alert(1)</script>'), ['application/json', INERT]);
});
