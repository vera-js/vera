/**
 * **Generated ids restart at each server render** (`@verajs/ssr` 0.3.7). The hooks that give elements ids count through
 * one record every copy of the library shares (`globalThis[Symbol.for('vera.uid')]`, `{ n }`); in a server it lives as
 * long as the process, so the same page used to serve `vu1…` to one request and `vu4…` to the next. Each render now
 * sets `n` back to 0 as it starts. The record is mutated, never replaced: `@vera-hooks/labeled` holds the object it
 * found when it loaded, so it is imported here BEFORE the first render, and replacing the record would leave it counting
 * on. The trade, stated in the README: ids are unique within a render, so a page assembled from two renders repeats them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@vera-hooks/labeled';
import { renderToString, renderToStringAsync } from '@verajs/ssr';

const page = new URL('./fixtures/ssr/uid-labeled.js', import.meta.url);
/** The generated ids a render served, in order. */
const ids = (rendered) => [...rendered.html.matchAll(/\bid="(vu[^"]*)"/g)].map((m) => m[1]);

test('one page rendered twice in one process serves the same ids', async () => {
  const first = await renderToString(page);
  const second = await renderToString(page);
  assert.equal(ids(first).length, 3, `CONTROL: the render numbered all three labels: ${first.html}`);
  assert.deepEqual(ids(second), ids(first));
  const third = await renderToStringAsync(page);
  assert.deepEqual(ids(third), ids(first), 'and the asynchronous chain numbers them the same');
});

test('renders started together still serve the same ids, because renders take turns', async () => {
  const all = await Promise.all([renderToString(page), renderToStringAsync(page), renderToString(page)]);
  assert.equal(ids(all[0]).length, 3, 'CONTROL: numbered');
  for (const rendered of all) assert.deepEqual(ids(rendered), ids(all[0]));
});

test('the trade: ids are unique within a render, so a page assembled from two renders repeats them', async () => {
  const joined = ids(await renderToString(page)).concat(ids(await renderToString(page)));
  assert.equal(joined.length, 6, 'CONTROL: both renders numbered');
  assert.equal(new Set(joined).size, 3, 'each id appears twice: render a page in one call');
});
