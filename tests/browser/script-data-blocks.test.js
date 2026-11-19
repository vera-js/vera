import { expect } from '@esm-bundle/chai';
import { escapeRawText } from '../../packages/ssr/dist/vera/escaping.js';

/**
 * **A JSON data block the server writes keeps the page whole, in the engines** (2026-11-17). A value holding
 * `<!--<script>` in a script's text puts the tokenizer in its double-escaped state, which ignores the `</script>` that
 * should close it, and the rest of the page becomes script text — measured on all three engines (BROWSER-LEDGER). The
 * server writes a data block's value with `<` as `\u003c` (`escapeRawText`'s `json`): the page stays whole and the JSON
 * reads back unchanged. The control, the same value unescaped, must swallow the page, or this row measures nothing.
 */
const VALUE = '<!--<script></script><b id="zqinj">x</b>';
const page = (text) => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frame.contentDocument.open();
  frame.contentDocument.write(`<!doctype html><body><script type="application/ld+json">{"name":${text}}</script><p id="after">after</p>`);
  frame.contentDocument.close();
  const doc = frame.contentDocument;
  const result = { intact: doc.getElementById('after') !== null && doc.getElementById('zqinj') === null, text: doc.querySelector('script')?.textContent };
  frame.remove();
  return result;
};

it('CONTROL: the value unescaped swallows the rest of the page (the double-escaped script state)', () => {
  expect(page(`"<!--<script>"`).intact).to.equal(false);
});

it('the value as the server writes it (`<` as \\u003c) keeps the page whole and reads back unchanged', () => {
  const { intact, text } = page(escapeRawText(JSON.stringify(VALUE), 'json'));
  expect(intact).to.equal(true);
  expect(JSON.parse(text).name).to.equal(VALUE);
});
