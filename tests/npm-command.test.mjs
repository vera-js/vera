/**
 * **The scripts start npm and find builds on every platform** (`scripts/npm.mjs`, `scripts/build-processes.mjs`).
 * Found 2026-11-20 on the Windows machine: `npm run typecheck`, `scripts/clean-build.mjs` (`ps -Ao`, then a bare
 * `npm`) and the gate's npm steps all failed before doing any work. These rows run on whichever platform runs them,
 * so CI holds the POSIX half and the Windows machine the other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmCommand } from '../scripts/npm.mjs';
import { buildProcesses } from '../scripts/build-processes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('npm starts through npmCommand on this platform', () => {
  const run = spawnSync(...npmCommand('npm', ['--version']), { encoding: 'utf8' });
  assert.equal(run.error, undefined, `spawn failed: ${run.error?.code}`);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('CONTROL: on Windows the bare name cannot be spawned, which is the fault npmCommand fixes', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  assert.equal(spawnSync('npm', ['--version']).error?.code, 'ENOENT');
});

test('on macOS and Linux the command is left exactly as written', () => {
  for (const platform of ['darwin', 'linux']) assert.deepEqual(npmCommand('npx', ['tsc', '-p', 'x'], platform), ['npx', ['tsc', '-p', 'x']]);
});

/** A sleeping node process whose command line names a rollup under `dir`, working in `cwd`. */
const plant = (dir, cwd) => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', join(dir, 'node_modules', 'rollup', 'planted.js')], { cwd, stdio: 'ignore' });

test('buildProcesses finds a build in this tree and ignores one in another (planted)', async (t) => {
  const here = plant(ROOT, ROOT);
  const elsewhere = plant(join(tmpdir(), 'another-tree'), tmpdir());
  t.after(() => {
    here.kill();
    elsewhere.kill();
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const found = buildProcesses(ROOT);
  assert.ok(found.some((row) => row.startsWith(`${here.pid} `)), `the in-tree plant (${here.pid}) is missed:\n${found.join('\n')}`);
  assert.ok(!found.some((row) => row.startsWith(`${elsewhere.pid} `)), 'a build in another tree is not this tree’s');
});

test('test-batch sets leading NAME=value arguments in the command environment, in any shell', () => {
  const run = spawnSync(process.execPath, ['scripts/test-batch.mjs', '--light', 'VERA_PROBE=yes', 'node', '-e', "process.exit(process.env.VERA_PROBE === 'yes' ? 0 : 3)"], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(run.status, 0, `the variable did not arrive (exit ${run.status}) ${run.stderr}`);
});

test("test-batch hands its batch to the command, so a command running its own heavy batch inherits it instead of waiting on its parent's lock", () => {
  const env = { ...process.env, VERA_HEAVY_LOCK: join(tmpdir(), `vera-heavy-row-${process.pid}.lock`) };
  delete env.VERA_HEAVY_BATCH;
  const run = spawnSync(process.execPath, ['scripts/test-batch.mjs', '--light', 'node', '-e', "process.stdout.write(process.env.VERA_HEAVY_BATCH ?? 'unset')"], { cwd: ROOT, encoding: 'utf8', env, timeout: 60000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'tests', 'the command did not see the batch test-batch started');
});

test('test-batch starts a project tool from node_modules/.bin', () => {
  const run = spawnSync(process.execPath, ['scripts/test-batch.mjs', '--light', 'tsc', '--version'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Version \d+\./);
});

/**
 * **`--light` refuses a command that runs a heavy batch of its own** (2026-11-21): the command inherits this batch, so
 * its own 2-minute pause is skipped too. Planted in a temporary directory, so a refusal that stopped working runs a
 * script that exits 0 rather than a real gate or suite: a script that imports `heavyBatch` (from a stub), an npm script
 * that runs `test-batch.mjs` unmarked, one that names the script, one that chains to that one through another npm script,
 * npm's aliases for both, and an npm form the check cannot read. The light forms beside them still run (CONTROL).
 */
test('test-batch --light refuses a command that runs a heavy batch of its own, by name, and runs a light one', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vera-light-row-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'heavy-batch.mjs'), 'export const heavyBatch = () => () => {};\n');
  writeFileSync(join(dir, 'heavy.mjs'), "import { heavyBatch } from './heavy-batch.mjs';\nheavyBatch('x')();\n");
  writeFileSync(join(dir, 'light.mjs'), 'process.exit(0);\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    scripts: {
      batch: 'node scripts/test-batch.mjs node light.mjs',
      named: 'node heavy.mjs',
      test: 'node heavy.mjs',
      chain: 'npm run plain && npm run named',
      plain: 'node light.mjs',
      plains: 'npm run plain && npm run-script plain',
    },
  }));
  const batch = fileURLToPath(new URL('../scripts/test-batch.mjs', import.meta.url));
  const env = { ...process.env, VERA_HEAVY_LOCK: join(dir, 'heavy.lock') };
  delete env.VERA_HEAVY_BATCH;
  const light = (...command) => spawnSync(process.execPath, [batch, '--light', ...command], { cwd: dir, encoding: 'utf8', env, timeout: 60000 });
  for (const [command, why] of [
    [['node', '--conditions', 'development', 'heavy.mjs'], 'heavy.mjs runs a heavy batch of its own'],
    [['npm', 'run', 'batch'], 'npm run batch is a heavy batch'],
    [['npm', 'run', 'named'], 'npm run named runs heavy.mjs, a heavy batch of its own'],
    [['npm', 'run-script', 'named'], 'npm run named runs heavy.mjs, a heavy batch of its own'],
    [['npm', 't'], 'npm run test runs heavy.mjs, a heavy batch of its own'],
    [['npm', 'run', 'chain'], 'npm run chain runs npm run named runs heavy.mjs, a heavy batch of its own'],
    [['npm', 'exec', 'x'], 'npm exec x is not a form it can read'],
  ]) {
    const run = light(...command);
    assert.equal(run.status, 1, `--light ${command.join(' ')} ran (exit ${run.status})`);
    assert.ok(run.stderr.includes(`--light is for one light file, and ${why}`), `--light ${command.join(' ')}: ${run.stderr}`);
  }
  for (const command of [['node', 'light.mjs'], ['npm', 'run', 'plain'], ['npm', 'run', 'plains']]) {
    const run = light(...command);
    assert.equal(run.status, 0, `CONTROL: the light --light ${command.join(' ')} was refused or failed: ${run.stderr}`);
  }
});
