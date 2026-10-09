/**
 * **Renderer warnings that had no positive pin** (vera-5a's list from the docs-claims pass, 2026-10-09), now coded:
 * a boolean at a child position (`boolean-child`), a spread key that cannot be written into markup
 * (`spread-unsafe-name`), and the keyed list's duplicate key — said once per (list, key), so the same duplicate on
 * every reconcile is one line and a NEW duplicate is news (`keyed-duplicate-key`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { spread } = await load('renderer/spread');
const { keyed } = await load('renderer/keyed');
core.wire([renderer]);
const { html } = core;

const said = (run, code) => {
  const lines = [];
  const warn = console.warn;
  console.warn = (...args) => lines.push(String(args[0]));
  try { run(); } finally { console.warn = warn; }
  return lines.filter((line) => line.includes(`(${code})`) || line.includes(`/e/${code}`));
};

test('boolean-child: false renders as the word and is named; the same value again is quiet; a flip speaks again', () => {
  const host = document.createElement('div');
  const draw = (value) => renderInto(html`<p>${value}</p>`, host);
  const first = said(() => draw(false), 'boolean-child');
  assert.equal(host.textContent, 'false', 'the CONTROL: it renders as the word');
  const repeat = said(() => draw(false), 'boolean-child');
  const flip = said(() => draw(true), 'boolean-child');
  if (isProduction) return assert.deepEqual([...first, ...repeat, ...flip], []);
  assert.equal(first.length, 1, first.join(' | '));
  assert.match(first[0], /^\[vera\] renderer: a child position — a child position was given `false`[\s\S]*\(boolean-child\)$/);
  assert.equal(repeat.length, 0, 'the dirty check skips a repeat');
  assert.equal(flip.length, 1, 'a change to true speaks again');
});

test('spread-unsafe-name: a key that cannot be written into markup is skipped and named', () => {
  const host = document.createElement('div');
  const lines = said(() => renderInto(html`<p ${spread({ 'a b': 1, title: 'kept' })}></p>`, host), 'spread-unsafe-name');
  const p = host.querySelector('p');
  assert.deepEqual([...p.attributes].map((a) => a.name), ['title'], 'skipped; its neighbor kept (the CONTROL)');
  if (isProduction) return assert.deepEqual(lines, []);
  assert.equal(lines.length, 1, lines.join(' | '));
  assert.match(lines[0], /^\[vera\] spread: <p> — refusing "a b" — an attribute name cannot contain whitespace[\s\S]*\(spread-unsafe-name\)$/);
});

test('keyed-duplicate-key: once per (list, key) — the same duplicate again is quiet, a new one speaks', () => {
  const host = document.createElement('div');
  const draw = (keys) => renderInto(html`<ul>${keys.map((k) => keyed(k, html`<li>${k}</li>`))}</ul>`, host);
  draw(['a', 'b']);
  const first = said(() => draw(['x', 'a', 'x']), 'keyed-duplicate-key');
  const again = said(() => draw(['y', 'x', 'a', 'x']), 'keyed-duplicate-key');
  const fresh = said(() => draw(['z', 'q', 'q', 'a']), 'keyed-duplicate-key');
  if (isProduction) return assert.deepEqual([...first, ...again, ...fresh], []);
  assert.equal(first.length, 1, `the duplicate is said: ${first.join(' | ')}`);
  assert.match(first[0], /the key x is used by more than one item/);
  assert.equal(again.length, 0, 'the same duplicate on the next reconcile is noise, not news');
  assert.equal(fresh.length, 1, 'a NEW duplicate key in the same list is said');
  assert.match(fresh[0], /the key q /);
});
