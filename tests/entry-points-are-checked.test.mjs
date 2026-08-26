/**
 * **Three test files carry a hand-maintained list of "the published entry points."**
 *
 * `docs-public-exports`, `docs-imports` and `docs-recipes` each map bare specifiers to artifacts, and
 * each list was written by hand. A package that grows a subpath export therefore becomes public
 * without becoming checked — and nothing about a green suite would say so, because every list still
 * passes on what it contains.
 *
 * This is the scope problem those passes kept finding, one level up: the guards are correct, and
 * their reach is the thing to audit. So the reach is asserted here, against `package.json` — the one
 * place a subpath actually becomes public.
 *
 * The exclusions are listed with reasons rather than filtered out silently. An exclusion in a regex
 * is an accident waiting to be inherited; an exclusion with a sentence beside it is a decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

/** Entry points that are not importable JavaScript with a public API to document. */
const NOT_A_MODULE_SURFACE = {
  '@verajs/eslint-config': 'a flat-config module; its shape is the ESLint contract, not ours',
  '@verajs/tsconfig': 'JSON, not a module',
  '@verajs/tsconfig/base.json': 'JSON, not a module',
  '@verajs/tsconfig/package.json': 'JSON, not a module',
  '@verajs/jsx/standalone': 'a side-effect script for a browser — it exports nothing to document',
};

const declared = [];
for (const entry of readdirSync(`${root}packages`)) {
  const file = `${root}packages/${entry}/package.json`;
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.private) continue;
  for (const key of Object.keys(pkg.exports ?? {}))
    declared.push(pkg.name + (key === '.' ? '' : key.slice(1)));
}

/** The `PACKAGES` / `SOURCE_PACKAGES` maps out of a test file, by their literal keys. */
const specifiersIn = (file) => {
  const text = readFileSync(`${root}tests/${file}`, 'utf8');
  return [...text.matchAll(/'(@verajs\/[a-z/-]+)'\s*:/g)].map(([, specifier]) => specifier);
};

test('the declared entry points were actually found', () => {
  assert.ok(declared.length > 15, `found ${declared.length} declared entry points`);
  assert.ok(declared.includes('@verajs/renderer/keyed'), 'and they look right');
});

test('every published entry point is covered by the documentation checks', () => {
  const covered = new Set(specifiersIn('docs-public-exports.test.mjs'));
  const missing = declared.filter((specifier) => !covered.has(specifier) && !NOT_A_MODULE_SURFACE[specifier]);
  assert.deepEqual(
    missing,
    [],
    `these are public and their exports are documented by nobody:\n  ${missing.join('\n  ')}\n` +
      `Add each to PACKAGES or SOURCE_PACKAGES in tests/docs-public-exports.test.mjs, or to ` +
      `NOT_A_MODULE_SURFACE here with the reason it has no API to document.`
  );
});

test('every published entry point is covered by the import check', () => {
  const text = readFileSync(`${root}tests/docs-imports.test.mjs`, 'utf8');
  const covered = new Set([
    ...specifiersIn('docs-imports.test.mjs'),
    ...[...text.matchAll(/'(@verajs\/[a-z/-]+)'/g)].map(([, specifier]) => specifier),
  ]);
  const missing = declared.filter((specifier) => !covered.has(specifier) && !NOT_A_MODULE_SURFACE[specifier]);
  assert.deepEqual(missing, [], `not reachable by tests/docs-imports.test.mjs:\n  ${missing.join('\n  ')}`);
});

test('the exclusions are all real entry points, so the list cannot rot', () => {
  const stale = Object.keys(NOT_A_MODULE_SURFACE).filter((specifier) => !declared.includes(specifier));
  assert.deepEqual(stale, [], `excluded from a check, but no longer published:\n  ${stale.join('\n  ')}`);
});
