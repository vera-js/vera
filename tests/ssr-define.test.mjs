/**
 * **`define` on the server** (2026-10-21): a define-made component's declared ATTRIBUTES render from the
 * markup's values — the ssr shim upgrades the way the parser does (`attributeChangedCallback` per present observed
 * attribute, before `connectedCallback`), so the server writes what the client will render, and hydration has nothing to
 * correct. The control: the same component with no attributes renders the defaults (and `null` renders nothing).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr';

const url = new URL('./fixtures/ssr-define/attrs.mjs', import.meta.url);

test('declared attributes in the markup render on the server, camel-cased, sharing a declared prop', async () => {
  const { html } = await renderToString(url, { attributes: { label: 'Hello', 'data-count': '3', tone: 'loud' } });
  assert.match(html, /<b>Hello<\/b><i>3<\/i><u>loud<\/u>/, html);
  assert.match(html, /label="Hello"/, `the attribute stays in the markup: ${html}`);
});

test('CONTROL: with no attributes the server renders the defaults (null renders nothing)', async () => {
  const { html } = await renderToString(url);
  assert.match(html, /<b><\/b><i><\/i><u>plain<\/u>/, html);
});

test("define's formAssociated OPTION renders on the server: the static is set and attachInternals answers", async () => {
  const { html } = await renderToString(new URL('./fixtures/ssr-define/form.mjs', import.meta.url));
  assert.match(html, /<ssr-form[^>]*>/, `CONTROL: the element rendered: ${html}`);
  assert.match(html, /<b>form function<\/b>/, `the setup ran and its internals have setFormValue: ${html}`);
  assert.equal(customElements.get('ssr-form')?.formAssociated, true, 'the static, on the server too');
});

test("define's styles OPTION renders into the declarative shadow root on the server", async () => {
  const { html } = await renderToString(new URL('./fixtures/ssr-define/styled.mjs', import.meta.url));
  assert.match(html, /<template shadowrootmode="open">/, `CONTROL: a declarative shadow root: ${html}`);
  assert.match(html, /color: rgb\(1, 2, 3\)/, `the option's CSS is in it: ${html}`);
  assert.match(html, /<b>styled<\/b>/, html);
});
