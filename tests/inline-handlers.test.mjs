/**
 * **A bound inline event-handler attribute is refused — by the template scanner, by `spread`, and by the server.**
 *
 * `<button onclick=${text}>` wrote the value as an attribute the browser runs as code: data became code. The rule is
 * one definition, `on` and a letter in any case (`INLINE_HANDLER` in `@verajs/shared-utils`, twinned in `@verajs/ssr`),
 * so the three can never disagree; a STATIC handler (`onclick="save()"`) is the author's own and untouched, and a
 * function is bound as an event — `@click=${fn}` or `onClick=${fn}`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Element', 'DocumentFragment', 'customElements'])
  globalThis[key] = dom.window[key];

/** Renderer first: importing `@verajs/ssr` replaces `globalThis.document` with its own shim. */
const { renderInto } = await load('renderer');
const { spread } = await load('renderer/spread');
const { serializeTemplate } = await import('@verajs/ssr');
const raw = (strings, ...values) => ({ _$litType$: 1, strings, values });
const quietly = (work) => {
  const { warn } = console;
  const said = [];
  console.warn = (m) => said.push(String(m));
  try { work(); } finally { console.warn = warn; }
  return said;
};
const NAMES = ['onclick', 'onClick2', 'ONLOAD', 'onbeforeinput', 'onx'];

test('the client refuses a bound inline handler, whatever its case, and says so in development', () => {
  for (const name of ['onclick', 'ONLOAD', 'onbeforeinput']) {
    const host = dom.window.document.createElement('div');
    const said = quietly(() => renderInto(raw([`<button ${name}=`, '>b</button>'], 'alert(1)'), host));
    assert.equal(host.querySelector('button').getAttribute(name), null, `${name} was not written`);
    if (!isProduction) assert.ok(said.some((m) => m.startsWith(`[vera] <button> binds the \`${name}\``)), said.join('\n'));
  }
});

test('the server refuses it too, and keeps the rest of the tag', () => {
  for (const name of ['onclick', 'ONLOAD', 'onbeforeinput']) {
    const markup = serializeTemplate(raw([`<button ${name}=`, ' title=', '>b</button>'], 'alert(1)', 't'));
    assert.doesNotMatch(markup, new RegExp(name, 'i'), `${name} was not served`);
    assert.match(markup, /title="t"/);
  }
});

test('a spread key is refused by the same rule', () => {
  const host = dom.window.document.createElement('div');
  quietly(() => renderInto(raw(['<button ', '>b</button>'], spread({ onclick: 'alert(1)' })), host));
  assert.equal(host.querySelector('button').getAttribute('onclick'), null);
});

test('a STATIC handler is the author\'s own, and a function still binds as an event', () => {
  const host = dom.window.document.createElement('div');
  let clicks = 0;
  renderInto(raw(['<button onclick="window.__static = 1" onClick=', '>b</button>'], () => clicks++), host);
  const button = host.querySelector('button');
  assert.equal(button.getAttribute('onclick'), 'window.__static = 1', 'static handler untouched');
  button.dispatchEvent(new dom.window.Event('click'));
  assert.equal(clicks, 1, 'onClick=${fn} is an event');
});

test("the server's twin is the same rule as shared-utils'", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const rule = (source) => /export const INLINE_HANDLER = (\/.+\/[a-z]*);/.exec(source)?.[1];
  const client = rule(read('packages/shared-utils/src/markup-grammar.ts'));
  assert.ok(client, 'CONTROL: the rule was found');
  assert.equal(rule(read('packages/ssr/src/vera/escaping.js')), client);
  for (const name of NAMES) assert.ok(new RegExp(client.slice(1, -2), 'i').test(name), name);
  for (const name of ['on', 'title', 'o']) assert.ok(!new RegExp(client.slice(1, -2), 'i').test(name), name);
});
