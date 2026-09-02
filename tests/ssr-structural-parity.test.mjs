/**
 * The **structural** values at a child position, server against client.
 *
 * Pass 89 took this boundary for coercion — what a primitive becomes. This is the other half: what a
 * value that *is* a renderer construct becomes. `hold()` and `keyed()` are the two the client owns
 * and the server has to understand anyway, and **neither had ever been serialized by a test**.
 *
 * `hold` has form here. `serializeValue` records that it "used to fall through to `String(value)` and
 * serve the text `[object Object]` into the page" — `keyed()` survives because it mutates the
 * template and hands the same object back, while `hold` *wraps* one and nothing unwrapped it. That
 * fix has had no test since.
 *
 * Compared by **parsing** both sides, never as text: the two spell an escape differently and both are
 * correct, so a string comparison reports that as a divergence and buries the real ones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'Node', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment', 'Element'])
  globalThis[key] = dom.window[key];

/** Renderer first: importing `@verajs/ssr` replaces `globalThis.document` with its own shim. */
const { renderInto, hold } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { html } = await load('core');
const { serializeTemplate } = await import('@verajs/ssr');

const clean = (element) => element.innerHTML.replaceAll('<!---->', '');
const onServer = (template) => {
  const host = dom.window.document.createElement('div');
  host.innerHTML = serializeTemplate(template);
  return clean(host);
};
const onClient = (template) => {
  const host = dom.window.document.createElement('div');
  renderInto(template, host);
  return clean(host);
};

const CASES = {
  'hold wrapping a template': () => html`<div>${hold(html`<p>${'a'}</p>`)}</div>`,
  'hold wrapping a string': () => html`<div>${hold('plain')}</div>`,
  'hold wrapping null': () => html`<div>${hold(null)}</div>`,
  'a keyed row': () => html`<ul>${['a', 'b'].map((row) => keyed(row, html`<li>${row}</li>`))}</ul>`,
  'keyed and hold together': () =>
    html`<ul>${['a'].map((row) => keyed(row, html`<li>${hold(html`<b>${row}</b>`)}</li>`))}</ul>`,
  'a nested template': () => html`<div>${html`<p>${html`<b>deep</b>`}</p>`}</div>`,
  'an array of templates': () => html`<div>${[html`<i>1</i>`, html`<i>2</i>`]}</div>`,
  'a Set of strings': () => html`<div>${new Set(['x', 'y'])}</div>`,
};

for (const [label, build] of Object.entries(CASES)) {
  test(`server and client agree on ${label}`, () => {
    assert.equal(onServer(build()), onClient(build()));
  });
}

test('hold does not serialize as [object Object], which is the regression this guards', () => {
  const markup = serializeTemplate(html`<div>${hold(html`<p>${'a'}</p>`)}</div>`);
  assert.doesNotMatch(markup, /\[object Object\]/,
    'hold wraps a template and something stopped unwrapping it — see serializeValue');
  assert.match(markup, /<p>a<\/p>/, 'the held template did not reach the markup at all');
});
