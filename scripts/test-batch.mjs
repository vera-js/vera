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
import { readFileSync } from 'node:fs';
import { heavyBatch } from './heavy-batch.mjs';
import { canonicalCwd } from './fs-path.mjs';
import { npmCommand } from './npm.mjs';

/** Every child inherits the canonical cwd, whichever shell launched this (scripts/fs-path.mjs). */
canonicalCwd();

/**
 * Whether a script file starts a heavy batch of its own: it imports `heavyBatch` from `heavy-batch.mjs` (the five that do
 * on 2026-11-21: the gate, tier-suites, coverage-floor, this script and the SSG bench). A test that only names it does not.
 */
const batches = (file) => {
  try {
    return /^import \{[^}]*\bheavyBatch\b[^}]*\} from '[^']*heavy-batch\.mjs';/m.test(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
};
/** npm's names for running a package.json script: `run` and its aliases, and `test` and its. */
const NPM_RUN = new Set(['run', 'run-script', 'rum', 'urn']);
const NPM_TEST = new Set(['test', 't', 'tst']);
/** How deep a chain of npm scripts is followed; past it the command is refused, toward the pause. */
const NPM_DEPTH = 4;
/**
 * **Why `command` runs a heavy batch of its own**, or `undefined`: `node … <script>` whose script imports `heavyBatch`,
 * or an npm script that runs this script without `--light`, names such a script, or runs another npm script that does
 * (`test:all:steps` is `npm test && npm run test:prod && …`), followed up to `NPM_DEPTH`. An npm form this cannot read
 * (`npm exec`, a flag before `run`) is refused rather than guessed light. Code passed inline (`node -e`, `--import`) is
 * not read: the rule covers scripts named on the command line, not every way to start a batch.
 */
const ownBatch = (command, rest, depth = 0, seen = new Set()) => {
  if (command === 'node') {
    const file = rest.find((arg) => /\.m?js$/.test(arg) && batches(arg));
    return file ? `${file} runs a heavy batch of its own` : undefined;
  }
  if (command !== 'npm') return undefined;
  const name = NPM_RUN.has(rest[0]) ? rest[1] : NPM_TEST.has(rest[0]) ? 'test' : undefined;
  if (name === undefined) return `npm ${rest.join(' ')} is not a form it can read`;
  if (seen.has(name)) return undefined;
  seen.add(name);
  if (depth === NPM_DEPTH) return `npm run ${name} is past ${NPM_DEPTH} chained npm scripts`;
  const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts?.[name];
  if (typeof script !== 'string') return undefined;
  if (/test-batch\.mjs(?!\s+--light)/.test(script)) return `npm run ${name} is a heavy batch (${script.slice(0, 60)}…)`;
  const named = script.split(/\s+/).find((word) => /\.m?js$/.test(word) && batches(word));
  if (named) return `npm run ${name} runs ${named}, a heavy batch of its own`;
  for (const [, inner] of script.matchAll(/\bnpm\s+([^&|;]+)/g)) {
    const why = ownBatch('npm', inner.trim().split(/\s+/), depth + 1, seen);
    if (why) return `npm run ${name} runs ${why}`;
  }
  return undefined;
};

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
/**
 * **`--light` is for a light command** (2026-11-21): a command that runs a heavy batch of its own (a script that calls
 * `heavyBatch`, or an npm script that runs one or this script unmarked) inherits this batch, so it skips its own pause
 * too, and `--light` would smuggle a whole gate or suite past the 2-minute pause. Refused, naming the form that pauses.
 */
if (light) {
  const own = ownBatch(command, rest);
  if (own) throw new Error(`test-batch: --light is for one light file, and ${own}: run it without --light (it pauses itself)`);
}
heavyBatch('tests', { pause: !light })();
/**
 * The batch marker reaches the command: `env` was copied before `heavyBatch` set it, so a command that runs a heavy
 * batch of its own (`npm run test:tiers` is this script around `tier-suites.mjs`) took the lock again and waited on its
 * own parent forever; inside the gate it worked only because the gate had set the marker first (2026-11-21).
 */
env.VERA_HEAVY_BATCH = process.env.VERA_HEAVY_BATCH;
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
