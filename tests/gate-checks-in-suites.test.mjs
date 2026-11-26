/**
 * **Every committed generated file is current before the gate is reached.** `scripts/gate.mjs` runs a `--check` for
 * each generated file the repo commits (size claims, diagnostics, fixtures, the components page, the manifests), and
 * before this row only the manifests' ran in the node suites. So a stale or missing generated file passed the full
 * suites and went red 25 minutes into a gate: a new package's first diagnostic code with no `diagnostics.json`, and
 * the components page after a demo changed (twice in one day, 2026-11-25). The suites run before every landing gate,
 * so the same checks run here, read from the gate's own list: a `--check` added to the gate is covered without an
 * edit here.
 *
 * Cost: the seven checks take about 5 s together (the motion fixture 2 s of it). They read source and the built
 * bundles only, so they run once, in the development suite; the production suite skips them.
 *
 *   node --conditions development --test tests/gate-checks-in-suites.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fsPath } from '../scripts/fs-path.mjs';

const root = fsPath(new URL('..', import.meta.url));
const gateSource = readFileSync(`${root}scripts/gate.mjs`, 'utf8');

/**
 * The gate's `node … --check` steps, as `['name', 'node', [args]]` (the parse `tests/gate-and-ci-agree.test.mjs`
 * uses). Left out, by name: `tag-release`, which is red on a version commit until its tags are made, by design.
 */
const NOT_HERE = new Set(['tag-release']);
const checks = [...gateSource.matchAll(/\[\s*'([^']+)',\s*'node',\s*\[([^\]]*)\]\s*\]/g)]
  .map(([, name, args]) => ({ name, args: [...args.matchAll(/'([^']*)'/g)].map(([, a]) => a) }))
  .filter(({ name, args }) => args.includes('--check') && !NOT_HERE.has(name));

const production = process.env.VERA_DIST === 'production';

test('the gate has generated-file checks to run', () => {
  assert.ok(checks.length >= 7, `parsed ${checks.length} --check steps from scripts/gate.mjs: ${checks.map((c) => c.name).join(', ')}`);
  assert.ok(
    checks.some((c) => c.name === 'diagnostics') && checks.some((c) => c.name === 'components page'),
    'and parsed them correctly (the diagnostics and components page steps are among them)',
  );
});

for (const { name, args } of checks)
  test(`gate step "${name}" is current: node ${args.join(' ')}`, { skip: production && 'run once, in the development suite' }, () => {
    const env = { ...process.env };
    delete env.VERA_DIST;
    const run = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(
      run.status,
      0,
      `"${name}" is red, as it will be in the gate. Run it without --check to regenerate, then commit the result:\n${run.stdout}${run.stderr}`,
    );
  });
