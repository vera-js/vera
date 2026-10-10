/**
 * **No suite imports a package bare when its exports carry a `node` condition** (vera-5a, 2026-10-09). `npm test` sets
 * `--conditions development`; `npm run test:prod` sets none, so a bare import resolves `default` — the min — which is
 * what the production row means to run. A `node` key comes before `default`, so there a bare import resolves the NODE
 * build instead, and the production row silently stops testing the min: seven jsx suites did exactly that from the day
 * `@verajs/jsx` gained its `node` condition until they were routed through `tests/dist.mjs`. Such a package goes
 * through `load()`, which names the build under test. Generated from every package.json's `exports`, never a list,
 * so a `node` condition added to any package tomorrow is covered the day it lands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every specifier whose exports entry carries a `node` condition: `@verajs/jsx`, `@verajs/jsx/…`. */
const withNode = [];
for (const file of globSync('packages/*/package.json', { cwd: root })) {
  const { name, exports } = JSON.parse(readFileSync(root + file, 'utf8'));
  if (!exports || typeof exports !== 'object') continue;
  for (const [subpath, target] of Object.entries(exports))
    if (target && typeof target === 'object' && 'node' in target) withNode.push(subpath === '.' ? name : `${name}${subpath.slice(1)}`);
}

/** A deliberate bare import of such a package, with the reason it must be bare. None today. */
const ALLOWED = new Map([]);

/** The bare imports of `specifier` in a text: static `from '…'`, side-effect `import '…'`, and `import('…')`. */
const bareImports = (text, specifier) => {
  const quoted = specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return [...text.matchAll(new RegExp(`(?:from|import|import\\()\\s*['"]${quoted}['"]`, 'g'))].length;
};

test('the scan reads every form, so a silence means something (CONTROL)', () => {
  assert.ok(withNode.includes('@verajs/jsx'), `CONTROL: @verajs/jsx has a node condition — found ${withNode.join(', ')}`);
  assert.equal(bareImports("import { a } from '@verajs/jsx';\nimport '@verajs/jsx';\nawait import('@verajs/jsx');", '@verajs/jsx'), 3);
  assert.equal(bareImports("import { a } from '@verajs/jsx/standalone';", '@verajs/jsx'), 0, 'a subpath is its own specifier');
});

test('no test imports a package with a node condition bare — it goes through load()', () => {
  const found = [];
  for (const file of globSync('tests/**/*.{mjs,js}', { cwd: root })) {
    if (file === 'tests/bare-import-conditions.test.mjs') continue;
    /**
     * The browser suites resolve through @web/test-runner, whose node-resolve passes the conditions
     * `default, module, import, development` (measured in its source, 2026-10-09) — never `node` — so a bare import there
     * is the development build in every run, and their pages resolve through import maps.
     */
    if (file.startsWith('tests/browser/')) continue;
    const text = readFileSync(root + file, 'utf8');
    for (const specifier of withNode)
      if (bareImports(text, specifier) && !ALLOWED.has(`${file} ${specifier}`)) found.push(`${file}: ${specifier}`);
  }
  assert.deepEqual(found, [], 'a bare import resolves `node` under test:prod, not the min — use load() from tests/dist.mjs');
});
