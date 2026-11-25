/**
 * The server writes a page top-down, in one pass, and the README says what that means for shared state: a component's
 * markup is written before its children are built, so a descendant's write during its own setup to state an ancestor
 * rendered is in the descendant's markup and not in the ancestor's. Pinned here so the sentence stays true, with the
 * write's own effect as the control (the child serves the value it wrote) and the README's remedy (settle the state
 * before the ancestor renders) served with the written value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr';

const PAGE = new URL('./fixtures/ssr/render-order-ssr.js', import.meta.url);
const values = (markup) => [...markup.matchAll(/<(span|b)>(\d)<\/\1>/g)].map(([, tag, value]) => `${tag}=${value}`);

test("a descendant's write during its setup is in its own markup, not in the ancestor's already written", async () => {
  const { html } = await renderToString(PAGE, { tag: 'order-parent-ssr' });
  assert.deepEqual(values(html), ['span=0', 'b=1'], html);
});

test('state settled before the ancestor renders is served everywhere', async () => {
  const { html } = await renderToString(PAGE, { tag: 'order-settled-ssr' });
  assert.deepEqual(values(html), ['span=1', 'b=1'], html);
});
