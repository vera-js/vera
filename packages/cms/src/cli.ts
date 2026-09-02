/**
 * The command line over `node.ts` — thin on purpose: parse arguments, call, present, set the exit
 * code. Anything with a decision in it belongs one file down, where it is testable without a
 * process.
 *
 *   node …/vera-cms-cli.js                     # build content/ -> _manifests/
 *   node …/vera-cms-cli.js --check             # fail if what is on disk is not what content produces
 *   node …/vera-cms-cli.js --content=src/content --out=dist/_manifests
 *
 * `--check` exists for the same reason every generated artifact in this repository carries one: a
 * committed artifact nothing verifies goes stale silently, and the gate is where that gets caught.
 * `process.exitCode` rather than `process.exit()`, so stdout finishes flushing before the process
 * ends.
 */
import process from 'node:process';
import { buildManifests, checkManifests, BuildOptions } from './node.js';

/**
 * **Streams, never `console`, and both halves of that are conventions with teeth.** The production
 * build drops `console.log`, so a success line printed with it vanishes from the artifact — caught
 * by the production run of the suite, not by reading. And `console.warn`/`error` are the
 * framework's diagnostic channel, every line prefixed `[vera]` so a user can filter for them —
 * a gate asserts it across every source file. A CLI is neither: its stdout and stderr ARE its
 * function, so it owns them directly and the diagnostic channel stays clean for diagnostics.
 */
const print = (line: string) => process.stdout.write(`${line}\n`);
const complain = (line: string) => process.stderr.write(`${line}\n`);

const options: BuildOptions = {};
let check = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--check') check = true;
  else if (arg.startsWith('--content=') && arg.length > '--content='.length) options.content = arg.slice('--content='.length);
  else if (arg.startsWith('--out=') && arg.length > '--out='.length) options.out = arg.slice('--out='.length);
  else {
    complain(`vera-cms: unknown argument "${arg}" — the options are --check, --content=<dir>, --out=<dir>`);
    process.exitCode = 1;
  }
}

/**
 * Failures present as the CLI's own sentence, never a stack — a missing content directory is a
 * misconfiguration to name, not an exception to dump (`--content=` with an empty value once
 * printed a raw ENOENT trace; the empty value is now an unknown argument, and anything the
 * pipeline throws lands here).
 */
if (process.exitCode === undefined) {
  try {
    run();
  } catch (error) {
    complain(`vera-cms: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

function run(): void {
  if (check) {
    const { stale, missing, orphaned } = checkManifests(options);
    for (const path of missing) complain(`vera-cms: ${path} is missing`);
    for (const path of stale) complain(`vera-cms: ${path} is stale`);
    for (const path of orphaned) complain(`vera-cms: ${path} is orphaned — nothing produces it any more; delete it`);
    if (stale.length + missing.length + orphaned.length > 0) {
      complain('vera-cms: the manifests no longer match the content. Rebuild and commit them.');
      process.exitCode = 1;
    } else {
      print('vera-cms: manifests match the content');
    }
  } else {
    const { written, warnings } = buildManifests(options);
    for (const warning of warnings) complain(`vera-cms: ${warning}`);
    print(`vera-cms: wrote ${written.length} file${written.length === 1 ? '' : 's'}`);
  }
}
