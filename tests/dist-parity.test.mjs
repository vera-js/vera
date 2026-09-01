/**
 * The development build and the production build must behave identically.
 *
 * They are different programs. Production mangles properties, folds `__DEV__` to `false` and deletes
 * the branches behind it, drops `console.log`, and inlines workspace dependencies that development
 * keeps external. Every suite in this directory runs against both — but each one asserts *its own*
 * expectations in each build, so a behaviour that differs between them satisfies both halves and
 * nothing notices.
 *
 * This renders one fixed corpus in each build and diffs the output: sixty items covering every
 * binding kind, the values that behave oddly (`0`, `NaN`, `-0`, `false`, bigint, nested arrays), a
 * part changing kind across a sequence, `spread` including names that must be skipped, a runtime
 * `tag`, keyed reconciliation over a fixed script, `hold`, and a real component with hooks, a
 * computed, a `Map`, a `Set` and a ref.
 *
 * Two child processes rather than two imports: under the `development` condition workspace deps stay
 * external and every copy of core shares one insert registry, so a single process cannot hold both
 * builds honestly — the same reason `docs-recipes` isolates per process.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { isProduction } from './dist.mjs';

const corpus = fileURLToPath(new URL('./fixtures/dist-parity-corpus.mjs', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));

const run = (condition) =>
  execFileSync(process.execPath, ['--conditions', condition, corpus], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, VERA_DIST: condition === 'production' ? 'production' : 'development' },
  })
    .split('\n')
    .filter((line) => line && !line.startsWith('###'));

/** Run once rather than once per build: this test *is* the comparison, so the gate's second pass
 * would only spawn the same two children again. */
test('the development and production builds render the corpus identically', { skip: isProduction && 'this test compares both builds itself' }, () => {
  const development = run('development');
  const production = run('production');

  assert.ok(development.length > 50, `the corpus produced only ${development.length} items`);
  assert.equal(production.length, development.length, 'the two builds produced different numbers of items');

  const differences = development
    .map((line, i) => (line === production[i] ? null : `  ${line.split(' :: ')[0]}\n    development: ${line.split(' :: ')[1]}\n    production:  ${production[i]?.split(' :: ')[1]}`))
    .filter(Boolean);

  assert.deepEqual(differences, [], `the builds disagree:\n${differences.join('\n')}`);

  /** And nothing in the corpus threw in either build, or the comparison is between two failures. */
  assert.deepEqual(
    development.filter((line) => line.includes('THREW')),
    [],
    'a corpus item threw in development'
  );
  assert.deepEqual(
    production.filter((line) => line.includes('THREW')),
    [],
    'a corpus item threw in production'
  );
});
