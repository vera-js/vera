/**
 * **An attribute selector's value, read as the engines read it.** Two gaps answered wrong without a word: HTML matches
 * the values of a list of attributes (`lang`, `type`, `dir`, …) case-insensitively without an `i` flag, on an HTML
 * element only and never with `s`; and a value may hold CSS escapes, where a quoted value used to end at its first
 * quote, escaped or not, and fall through to the bare form WITH its quotes. The shim is held to the engines' answers,
 * measured on three engines by `tests/browser/selector-values.test.js` from the same table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('@verajs/ssr');
const shim = globalThis.document;
const { ROWS, answer } = await import('./fixtures/selector-values.mjs');

test('attribute selectors answer as the engines do: HTML\'s case-insensitive values, and CSS escapes', () => {
  assert.ok(ROWS.length >= 20, 'the table is read, not empty');
  const differ = [];
  for (const [selector, ids] of ROWS) {
    const ours = answer(shim, selector);
    if (ours !== ids) differ.push(`${JSON.stringify(selector)}: shim ${JSON.stringify(ours)}, engines ${JSON.stringify(ids)}`);
  }
  assert.deepEqual(differ, []);
});

/**
 * **A query over markup this DOM declined says so, as `children` does** (`ssr-markup-declined`): it answered emptily
 * and said nothing, so a component branched on a missing element with no reason given.
 */
test('a query over declined markup warns once', () => {
  const warned = [];
  const warn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    const element = shim.createElement('div');
    element.innerHTML = '<p id=q>a</b>';
    element.querySelector('#q');
    element.querySelector('#q');
    const outer = shim.createElement('section');
    const inner = shim.createElement('div');
    inner.innerHTML = '<i>x</b>';
    outer.append(inner);
    outer.getElementsByTagName('i');
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.filter((line) => line.includes('ssr-markup-declined')).length, 1, warned.join('\n'));
});
