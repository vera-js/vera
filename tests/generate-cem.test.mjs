/**
 * **`scripts/generate-cem.mjs` refuses what it must, and every component's committed manifest is current.** One shared
 * generator writes each component's `custom-elements.json` from its declared surfaces; these rows hold its refusals,
 * each on a fixture under `tests/fixtures/cem/` that declares `customElements` the way a package does: a package with no
 * surface, a surface with an empty description, and a committed manifest that disagrees with its surface. Each is
 * refused rather than skipped, because skipping is a manifest declared and never generated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/generate-cem.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The generator over `args`, from the root, as the gate runs it. */
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });

test('every package that declares customElements has a current manifest, and the walk found one', () => {
  const result = run('--check');
  assert.equal(result.status, 0, result.stderr);
  /** The floor: the header names what was checked, so a walk that found nothing cannot pass in silence. */
  assert.match(result.stdout, /^custom-elements manifests for: .*packages\/components\/select/m);
  assert.match(result.stdout, /every custom-elements\.json matches its declared surfaces/);
});

test('a package that declares customElements and exports no surface is refused, not skipped', () => {
  const result = run('tests/fixtures/cem/no-surface', '--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tests\/fixtures\/cem\/no-surface declares customElements but exports no surface/);
});

test('a surface with an empty description is refused, naming its file', () => {
  const result = run('tests/fixtures/cem/empty-description', '--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tests\/fixtures\/cem\/empty-description\/src\/surface\.ts: <vera-cem-fixture> has an empty description/);
});

test('a committed manifest that disagrees with its surface is refused, naming the package', () => {
  const result = run('tests/fixtures/cem/stale', '--check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /out of date with the declared surfaces in: tests\/fixtures\/cem\/stale\./);
});

test('one surface exported under two names, or re-exported by another surface.ts, is one module', () => {
  /** The fixture's committed manifest declares ONE module; a generator that counted names would write two and refuse. */
  const result = run('tests/fixtures/cem/twice', '--check');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /Warning/, 'the fixture loads as a module, as every package does');
});
