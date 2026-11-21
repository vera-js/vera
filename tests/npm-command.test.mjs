/**
 * **The scripts start npm and find builds on every platform** (`scripts/npm.mjs`, `scripts/build-processes.mjs`).
 * Found 2026-11-20 on the Windows machine: `npm run typecheck`, `scripts/clean-build.mjs` (`ps -Ao`, then a bare
 * `npm`) and the gate's npm steps all failed before doing any work. These rows run on whichever platform runs them,
 * so CI holds the POSIX half and the Windows machine the other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
