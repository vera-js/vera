/**
 * **The engines' answers to attribute selectors with HTML's case-insensitive values and CSS escapes**, the table the
 * SSR shim is held to (`tests/fixtures/selector-values.mjs`, read by `tests/ssr-selector-values.test.mjs`). jsdom is
 * not the oracle for these: it matches an SVG element's `type` case-insensitively, has no `s` flag, and drops a line
 * continuation and an escaped attribute name.
 */
import { expect } from '@esm-bundle/chai';
import { ROWS, CHROMIUM_THROWS, answer } from '../fixtures/selector-values.mjs';

const chromium = navigator.userAgent.includes('Chrome');

it('every engine answers the table', () => {
  const differ = [];
  for (const [selector, ids] of ROWS) {
    const expected = chromium && CHROMIUM_THROWS.has(selector) ? 'THREW SyntaxError' : ids;
    const got = answer(document, selector);
    if (got !== expected) differ.push(`${JSON.stringify(selector)}: ${JSON.stringify(got)}, table ${JSON.stringify(expected)}`);
  }
  expect(differ.join('\n')).to.equal('');
  expect(ROWS.length > 0).to.equal(true);
});
