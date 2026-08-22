/**
 * What minification must not do.
 *
 * Production applies four transformations the development build does not: property mangling,
 * `__DEV__` folding, `drop_console: ['log']`, and workspace inlining. Until now these were verified
 * only by "the other suites still pass", plus a manual check I ran by hand during the 2026-08-22
 * audit. Manual checks do not survive contact with a busy week.
 *
 * These assertions read the SHIPPED bundles directly rather than importing them, because what is
 * being tested is a property of the artifact, not of its behaviour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const PROD = {
  core: 'packages/core/dist/vera.min.js',
  renderer: 'packages/renderer/dist/vera-renderer.min.js',
  hydrate: 'packages/renderer/dist/vera-renderer-hydrate.min.js',
  router: 'packages/router/dist/vera-router.min.js',
  inserts: 'packages/inserts/dist/vera-inserts.min.js',
  styles: 'packages/styles/dist/vera-styles.min.js',
  autoloader: 'packages/autoloader/dist/vera-autoloader.min.js',
};

// ── cross-bundle contracts ──────────────────────────────────────────────────
//
// These names cross a bundle boundary, so every copy must spell them identically. The renderer
// mangles `/^_[a-z]/`, which is why each of these either starts `_$` or is unprefixed — and why a
// regex added to another package must reserve them. Getting this wrong fails silently: the
// callback simply lands where nothing looks for it.

test('the lit template contract survives minification', () => {
  for (const name of ['renderer', 'hydrate']) {
    const src = read(PROD[name]);
    for (const contract of ['_$litType$', 'strings', 'values']) {
      assert.ok(src.includes(contract), `${name}: ${contract} must not be mangled`);
    }
  }
});

test('the insert chain priority contract `_p` survives everywhere it is inlined', () => {
  /**
   * `_p` carries the priority order on an insert chain and is read by every inlined copy of
   * `@verajs/inserts`. Mangling it in one bundle and not another makes priorities silently ignored
   * and same-priority registration duplicate instead of replace.
   */
  for (const name of ['inserts', 'core', 'router']) {
    assert.ok(read(PROD[name]).includes('_p'), `${name}: _p must not be mangled`);
  }
});

test("core's cross-boundary properties survive minification", () => {
  const src = read(PROD.core);
  for (const contract of ['_hooks', '_isSignal', '_delete']) {
    assert.ok(src.includes(contract), `${contract} is public API or read across a boundary`);
  }
});

// ── drop_console ────────────────────────────────────────────────────────────

test('production drops console.log but keeps error and warn', () => {
  /**
   * `drop_console: ['log']`, not `true`. `console.error`/`warn` are how the library reports real
   * failures — the autoloader's load failure, core's hook-registration warning — and dropping them
   * would silence exactly the diagnostics a consumer needs.
   */
  const bundles = Object.entries(PROD).map(([n, p]) => [n, read(p)]);
  const withWarnOrError = bundles.filter(([, src]) => /console\.(error|warn)/.test(src));
  assert.ok(withWarnOrError.length > 0, 'at least one bundle reports failures to the console');

  for (const [name, src] of bundles) {
    assert.doesNotMatch(src, /console\.log\(/, `${name}: console.log should be dropped`);
  }
});

// ── __DEV__ folding ─────────────────────────────────────────────────────────

test('__DEV__ is folded away entirely in production', () => {
  for (const [name, path] of Object.entries(PROD)) {
    assert.doesNotMatch(read(path), /__DEV__/, `${name}: the constant must not reach production`);
  }
});

test('development-only code is absent from production bundles', () => {
  /** The profiler hook and the dev guards live behind `__DEV__`; none may survive the fold. */
  assert.doesNotMatch(read(PROD.renderer), /_profileHook/, 'profiler instrumentation is stripped');
  assert.doesNotMatch(read(PROD.core), /no renderer registered/, 'the dev guard message is stripped');
});

// ── workspace inlining ──────────────────────────────────────────────────────

test('production bundles are standalone — no bare workspace imports', () => {
  for (const [name, path] of Object.entries(PROD)) {
    assert.doesNotMatch(
      read(path),
      /from\s*["']@verajs\//,
      `${name}: production must inline workspace deps, not import them`
    );
  }
});

test('development bundles keep workspace deps external', () => {
  /** The mirror of the above: dev keeps them external so the consumer's bundler dedupes. */
  const dev = read('packages/core/dist/development/vera.js');
  assert.match(dev, /from\s*['"]@verajs\/inserts['"]/, 'core imports inserts rather than inlining it');
});
