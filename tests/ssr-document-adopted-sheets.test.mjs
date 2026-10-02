/**
 * **`document.adoptedStyleSheets` on the server is a live list, and every sheet that joins it is hoisted.** It read
 * as an empty array and its setter hoisted only the LAST sheet assigned, so `document.adoptedStyleSheets = [a, b]`
 * served `b` and dropped `a`, and nothing that adopted could read its sheets back. Each render is its own page, so
 * the list starts empty per render.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr';

const PAGE = new URL('./fixtures/ssr/adopted-sheets-ssr.js', import.meta.url);

test('every sheet adopted onto the document is hoisted — by assignment of several, and by push', async () => {
  const { styles } = await renderToString(PAGE, {});
  for (const css of ['.a { color: red }', '.b { color: blue }', '.c { color: green }']) assert.ok(styles.includes(css), `${css} in ${styles}`);
});

test('the list reads back, rejects what the platform rejects before changing, and starts empty on each render', async () => {
  await renderToString(PAGE, {});
  assert.equal(globalThis.__adopted.before, 0);
  assert.equal(globalThis.__adopted.after, 3);
  assert.deepEqual(globalThis.__adopted.errors, ['TypeError', 'TypeError', 'TypeError']);
  assert.equal(globalThis.__adopted.kept, 3, 'a refused assignment changes nothing');
});

/**
 * **What counts as a sequence is the platform's answer**, recorded on all three engines in
 * `tests/browser/adopted-sheets-sequence.test.js`: an array, a `Set` and a generator are accepted; an array-like, a
 * lone sheet and a string are a `TypeError`. The shim took only an array, which refused working client code.
 */
test('the document and a shadow root take any iterable of sheets, and refuse what every engine refuses', async () => {
  await renderToString(PAGE, {});
  const row = ['accepted', 'accepted', 'TypeError', 'TypeError', 'TypeError'];
  assert.deepEqual(globalThis.__adopted.sequences, [row, row]);
});

test('a sheet adopted empty and filled afterwards is served', async () => {
  const { styles } = await renderToString(PAGE, {});
  assert.ok(styles.includes('.late { color: purple }'), styles);
});
