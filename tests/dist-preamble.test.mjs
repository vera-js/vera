/**
 * **The hydration bundle's compile hint is its FIRST line** — invisible when it is missing, so it is pinned here: a
 * terser or rollup upgrade that drops it fails the gate instead of quietly costing every CDN page's first hydration
 * ~0.3 ms (measured on V8 traces, `packages/renderer/rollup.config.js`). Chromium reads the magic comment only at the
 * top of a file.
 *
 * And its source map was OFFSET with it: the preamble is written by terser, so the first mapped segment is on line 2.
 * A string prepended after minification would leave the map pointing one line off for every production stack trace.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../packages/renderer/dist/${p}`, import.meta.url), 'utf8');

test('the production hydration bundle opens with the compile hint, and its source map is offset for it', () => {
  const code = read('vera-renderer-hydration.min.js');
  assert.equal(code.split('\n')[0], '//# allFunctionsCalledOnLoad');
  const { mappings } = JSON.parse(read('vera-renderer-hydration.min.js.map'));
  assert.equal(mappings[0], ';', 'line 1 (the hint) maps to nothing — the code begins on line 2');
  assert.notEqual(mappings[1], ';', 'CONTROL: line 2 does carry mappings');
});

test('CONTROL: the base renderer carries no hint — every app loads it, and not all of it runs on load', () => {
  assert.equal(read('vera-renderer.min.js').startsWith('//#'), false);
});
