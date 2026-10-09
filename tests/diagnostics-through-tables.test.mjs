/**
 * **Every message in a package on the code system comes from its table** (vera-5a, 2026-10-09). The sweep and the
 * tables test read REGISTERED codes; a message written inline is invisible to both — exactly what A1–A3 did first. So:
 *
 * 1. SOURCE: in a migrated package, no `throw new …Error(` and no `console.warn(`/`console.error(` takes a literal —
 *    its text comes through `misuse()` / `diagnostic()`, whose prose is the table's.
 * 2. BUNDLES: no table prose survives in the production bundle — what "development-only costs 0 B" rests on.
 *
 * MIGRATED grows as packages move onto the code system (the rest: the pre-release migration piece).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES, proseOf } from '../scripts/diagnostic-tables.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
/**
 * `[package, a production bundle that carries its code]`. shared-utils is private and inlined: its own min bundle
 * exports every shared text and never ships, so it is checked through the renderer's, which inlines it.
 */
const MIGRATED = [
  ['core', 'dist/vera.min.js'],
  ['styles', 'dist/vera-styles.min.js'],
  /** Every renderer entry ships its own bundle — tag, keyed, slots… — so every one is checked. */
  ['renderer', 'dist/*.min.js'],
  ['shared-utils', '../renderer/dist/vera-renderer.min.js'],
];
/**
 * Error ROUTING, not messages (the migration plan excludes it): `reportUncaught` prints the caller's sentence beside an
 * error it forwards. Counted, so a second inline call in the file is a deliberate edit, not a free pass.
 */
const ROUTING = new Map([['packages/shared-utils/src/utils.ts', 2]]);
const INLINE = /(?:throw new \w*Error|console\.(?:warn|error))\(\s*[`'"]/g;

for (const [name, bundle] of MIGRATED) {
  test(`${name}: no inline message — every throw and warning goes through its table`, () => {
    const files = globSync(`packages/${name}/src/**/*.ts`, { cwd: root }).filter((file) => !file.endsWith('diagnostics.ts'));
    assert.ok(files.length > 0, 'CONTROL: the package has sources');
    const inline = [];
    for (const file of files) {
      const text = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const found = [...text.matchAll(INLINE)].map((match) => `${file}:${text.slice(0, match.index).split('\n').length}`);
      if (ROUTING.get(file) === found.length) continue;
      inline.push(...found);
    }
    assert.deepEqual(inline, [], 'a message written inline — put its text in the package table and raise it by code');
  });

  test(`${name}: no table prose survives in the production bundle`, async () => {
    /** Its own tables AND the shared one — a package raising `SHARED['x']` must not ship that prose either. */
    const { tables } = TABLES.find((entry) => entry.name === name);
    const entries = [];
    for (const [owner, files] of [[name, tables], ['shared-utils', ['src/diagnostics.ts']]])
      for (const file of files) entries.push(...Object.entries(proseOf(await import(new URL(`../packages/${owner}/${file}`, import.meta.url).href))));
    const bundles = globSync(join('packages', name, bundle), { cwd: root });
    assert.ok(bundles.length > 0, `CONTROL: ${bundle} matched a bundle`);
    const min = bundles.map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
    assert.ok(entries.length > 0, 'CONTROL: the table has entries');
    const leaked = [];
    let checked = 0;
    for (const [code, prose] of entries) {
      /** A distinctive stretch of the first sentence, before its first parameter. */
      const [sentence] = prose('\u0000', '\u0000', '\u0000');
      const fragment = sentence.split('\u0000')[0].slice(0, 32).trim();
      if (fragment.length < 12) continue;
      checked++;
      if (min.includes(fragment)) leaked.push(`${code}: "${fragment}"`);
    }
    assert.ok(checked >= entries.length / 2, `CONTROL: ${checked} of ${entries.length} entries had a fragment to look for`);
    assert.deepEqual(leaked, [], 'table prose reached the production bundle — reference it only behind __DEV__');
  });
}
