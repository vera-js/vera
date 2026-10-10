/**
 * **"The full explanation of a code is at https://verajs.dev/e/<code>"** — what the core README and llms.txt promise
 * every `[vera]` line, whichever of its three production forms a user holds (vera-5a, 2026-10-09). The pages are
 * generated from the packages' `diagnostics.json` files (the docs-site release item); this pins what that generation
 * stands on: every code has a page's content (a message and a fix), every code is one URL-safe slug in one namespace,
 * and production prints exactly that address. Hosting the pages is checked where they are built.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tables = globSync('packages/*/diagnostics.json', { cwd: root }).map((file) => [file, JSON.parse(readFileSync(root + file, 'utf8'))]);

test('every diagnostics.json names the one docs address', () => {
  assert.ok(tables.length >= 5, `CONTROL: found ${tables.length} tables`);
  for (const [file, table] of tables) assert.equal(table.url, 'https://verajs.dev/e/', file);
  assert.match(readFileSync(root + 'packages/shared-utils/src/diagnostic.ts', 'utf8'), /export const DOCS = 'https:\/\/verajs\.dev\/e\/';/, 'and production prints it');
});

/**
 * A message that is ONLY its parameter (`"{detail}"`) would make a page that explains nothing — found by this test on
 * its first run (directives' directive-, fetch- and teardown-threw, fixed the same day). One left, with its reason.
 */
/** Empty since phase 4 (motion's five sequence codes replaced the one whose whole sentence was its parameter); kept
 *  so a future exception is a deliberate, reasoned entry rather than a loosened check. */
const PARAMETER_ONLY = new Map();

test('every code has a page to generate: a URL-safe slug, a message of its own, once across all packages', () => {
  const seen = new Map();
  for (const [file, table] of tables)
    for (const entry of table.entries) {
      assert.match(entry.code, /^[a-z][a-z0-9-]*$/, `${file}: "${entry.code}" is not a URL slug`);
      const own = String(entry.message ?? '').replace(/\{[a-z0-9]+\}/gi, '').trim();
      if (!PARAMETER_ONLY.has(entry.code)) assert.ok(own.replace(/[^a-z]/gi, '').length >= 5, `${file}: ${entry.code}'s message is only its parameters: ${JSON.stringify(entry.message)}`);
      assert.ok(seen.get(entry.code) === undefined, `${entry.code} is in ${seen.get(entry.code)} and ${file}`);
      seen.set(entry.code, file);
    }
  assert.ok(seen.size > 200, `CONTROL: ${seen.size} codes`);
});
