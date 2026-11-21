/**
 * **Every test run goes through here** (Brian, 2026-11-19: the heavy-batch rule lives in the tool, and `npm test` was a
 * bare `node --test`). Runs the command after `heavyBatch` (see `heavy-batch.mjs`): caffeinated and thermal-checked on
 * the macOS laptop, with the 2-minute batch pause unless `--light`; on CI none of it applies. Inside a gate the gate's own
 * batch holds all of that, so this only runs the command.
 *
 *   node scripts/test-batch.mjs node --conditions development --test "tests/**\/*.test.mjs"
 *   node scripts/test-batch.mjs --light node --conditions development --test tests/x.test.mjs   (one file: no pause)
 *   node scripts/test-batch.mjs VERA_DIST=production node --test "tests/**\/*.test.mjs"
 *
 * Leading `NAME=value` arguments are set in the command's environment. That replaces the shell prefix
 * (`VERA_DIST=production node …`), which only a POSIX shell understands: on Windows npm runs scripts through `cmd`, and
 * `npm run test:prod` failed with "'VERA_DIST' is not recognized" before any suite ran (2026-11-21).
 *
 * **A `node --test` names its build**: `--conditions development`, or `VERA_DIST` set (2026-11-21). With neither, a
 * bare `@verajs/*` import inside a bundle resolves to production while `tests/dist.mjs` loads development, so the run
 * mixes the two builds: select read 70 of 90 rows red on a green main that way, and a row that loads its package by path
 * still passes, which hides it. Refused here rather than defaulted, so the command says which build it ran.
 */
import { spawnSync } from 'node:child_process';
import { heavyBatch } from './heavy-batch.mjs';
import { canonicalCwd } from './fs-path.mjs';
import { npmCommand } from './npm.mjs';

/** Every child inherits the canonical cwd, whichever shell launched this (scripts/fs-path.mjs). */
canonicalCwd();

const ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)=(.*)$/s;
const argv = process.argv.slice(2);
const light = argv[0] === '--light';
const args = light ? argv.slice(1) : argv;
const env = { ...process.env };
while (args.length && ASSIGNMENT.test(args[0])) {
  const [, name, value] = ASSIGNMENT.exec(args.shift());
  env[name] = value;
}
const [command, ...rest] = args;
if (!command) throw new Error('usage: node scripts/test-batch.mjs [--light] <command> [args…]');
if (command === 'node' && rest.includes('--test') && !rest.some((arg) => arg.startsWith('--conditions')) && env.VERA_DIST === undefined)
  throw new Error('a node --test names its build: add --conditions development, or VERA_DIST=production before node (a run with neither mixes the two builds)');
heavyBatch('tests', { pause: !light })();
/**
 * npm and npx through `npmCommand`; on Windows a project tool (`web-test-runner`, `tsc`) is a `.cmd` in
 * `node_modules/.bin` that spawn cannot start either, so it runs through npx there (`--no`: never install). Node
 * itself and every command on macOS and Linux run as written.
 */
const [file, fileArgs] =
  command === 'npm' || command === 'npx'
    ? npmCommand(command, rest)
    : process.platform === 'win32' && command !== 'node'
      ? npmCommand('npx', ['--no', '--', command, ...rest])
      : [command, rest];
const run = spawnSync(file, fileArgs, { stdio: 'inherit', env });
if (run.error) throw run.error;
process.exit(run.status ?? 1);
