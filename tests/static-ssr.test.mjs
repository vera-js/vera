/**
 * **`@verajs/static` on the server** (`@verajs/ssr`): static components render there, through the server's DOM, and
 * the served markup — read back by a real parser — holds the values as text, the URL refusal, and SVG in its namespace.
 * Its own file because `@verajs/ssr` installs its DOM's globals for the process.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderToString } from '@verajs/ssr';

const FIXTURE = new URL('./fixtures/ssr/static-ssr.js', import.meta.url);
const served = async (tag) => {
  const { html } = await renderToString(FIXTURE, { tag });
  return [html, new JSDOM(`<!doctype html><body>${html}</body>`).window.document.querySelector(tag)];
};

test('static: renders on the server — text and attributes as text, a list, svg in its namespace', async () => {
  const [markup, host] = await served('ssr-static-card');
  assert.ok(host?.querySelector('h2'), `CONTROL: served (${markup})`);
  assert.equal(host.querySelector('h2').textContent, 'A "q" <b>');
  assert.equal(host.querySelector('h2').title, 'A "q" <b>');
  assert.equal(host.querySelector('b'), null, 'a value is text, never markup');
  assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.className), ['x', 'y']);
  assert.equal(host.querySelector('circle')?.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(host.querySelector('circle').getAttribute('r'), '5', 'an unquoted value before `/>` keeps the slash out');
});

test('static: on the server a script URL is written empty and markup in a value stays text', async () => {
  const [markup, host] = await served('ssr-static-attack');
  assert.ok(host?.querySelector('a'), `CONTROL: served (${markup})`);
  assert.doesNotMatch(host.querySelector('a').getAttribute('href') ?? '', /script/i);
  assert.equal(host.querySelector('img'), null);
});

test('static: a shadow component is served as a declarative shadow root', async () => {
  const [markup] = await served('ssr-static-shadow');
  /** jsdom parses a served declarative shadow root as a plain <template> (CLAUDE.md): read its content. */
  const template = new JSDOM(`<!doctype html><body>${markup}</body>`).window.document.querySelector('ssr-static-shadow > template');
  assert.equal(template?.getAttribute('shadowrootmode'), 'open', `CONTROL: served as a declarative root (${markup})`);
  assert.equal(template.content.querySelector('b')?.textContent, 'in');
});

/**
 * **A `?type` / `.type` binding on a static JSON block** (2026-11-19, Brian: static honors `?name` and drops `.prop`): a
 * false `?type` removes nothing real and `.type` is not written, so the block is served with its type `application/json`
 * and neither junk attribute (until 2026-11-19 they were served literally named, `?type="false"` — the tier suites found
 * it; a true `?type` empties the type, and the script's value is then refused: tests/tier-parity-fixes.test.mjs).
 */
test('static: a false ?type and a .type binding on a JSON block are not served; the type stays JSON', async () => {
  const [markup, host] = await served('ssr-static-typeswap');
  const script = host?.querySelector('script');
  assert.ok(script, `CONTROL: served (${markup})`);
  assert.equal(script.getAttribute('type'), 'application/json');
  assert.doesNotMatch(markup, /\?type|\.type/, markup);
});
