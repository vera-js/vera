/**
 * **No client renderer parses markup through an API that can run its scripts** (2026-11-18). A `<script>` parsed into a
 * `<template>` never runs, however its nodes reach the document (BROWSER-LEDGER), and that is what lets core's renderer
 * refuse an HTML script hole in development only. `createContextualFragment` DOES run an HTML script, in Chromium,
 * Firefox and WebKit (measured 2026-11-18); `insertAdjacentHTML`, `DOMParser` and the `*HTMLUnsafe` pair are parses
 * outside the template path that was measured, so they are held out too rather than assumed alike. The renderers —
 * core, the renderer, lite, static — must reach none of them: a future parse path through one would quietly invalidate
 * that policy.
 * (An SVG `<script>` runs from a template in Chromium and WebKit, which is why its holes are refused in every build.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = ['core', 'renderer', 'lite', 'static'];
/** The calls that parse markup outside a template: as a call or a property access, not inside a word. */
const PARSERS = /(?<![\w$])(?:createContextualFragment|insertAdjacentHTML|DOMParser|parseHTMLUnsafe|setHTMLUnsafe)(?![\w$])/;
/** Comment text is prose (it may name the APIs, as this file's header does): only code is scanned. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('CONTROL: the scan finds a planted call, and ignores one in a comment', () => {
  assert.equal(PARSERS.test(code('range.createContextualFragment(markup)')), true);
  assert.equal(PARSERS.test(code('/** never createContextualFragment */ const a = 1;')), false);
});

for (const name of PACKAGES)
  test(`${name}: no source file parses markup outside a <template>`, () => {
    const files = globSync(`packages/${name}/src/**/*.ts`, { cwd: root });
    assert.ok(files.length > 0, `CONTROL: ${name} has source files to scan`);
    const found = files.filter((file) => PARSERS.test(code(readFileSync(root + file, 'utf8'))));
    assert.deepEqual(found, []);
  });
