/**
 * **A repeated key is said wherever it can arise — including when one copy matches at the list's END scans.** The
 * development check runs one pass over the new keys whenever items lie between keyed's end scans (an insertion or
 * a move). A cheaper check — only inserted keys, plus the reorder map's "already taken" hit — misses this shape: the
 * first `K` is consumed by the common-prefix scan (never in the map, never inserted), the second sits mid-list.
 * Pinned so the cheaper check cannot come back without failing here first (vera-5a, 2026-10-01).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];
const { html } = await load('core');
const { renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');

const draw = (keys, host) => renderInto(html`<ul>${keys.map((k, i) => keyed(k, html`<li>${k}${i}</li>`))}</ul>`, host);

test('a repeated key whose first copy matches the common prefix is still said', { skip: isProduction && 'a development check' }, () => {
  const host = document.createElement('div');
  const said = [];
  const { warn } = console;
  console.warn = (message) => said.push(String(message));
  try {
    draw(['K', 'A'], host);
    said.length = 0;
    draw(['K', 'B', 'K'], host);
  } finally {
    console.warn = warn;
  }
  assert.ok(said.some((line) => /^\[vera\] keyed: the key K is used by more than one item/.test(line)), said.join('\n'));
});

test('a same-order update and a pure removal never warn', { skip: isProduction && 'a development check' }, () => {
  const host = document.createElement('div');
  const said = [];
  const { warn } = console;
  console.warn = (message) => said.push(String(message));
  try {
    draw(['a', 'b', 'c'], host);
    draw(['a', 'b', 'c'], host);
    draw(['a', 'c'], host);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(said, []);
});
