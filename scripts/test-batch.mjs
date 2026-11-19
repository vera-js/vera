/**
 * **Every test run goes through here** (Brian, 2026-11-19: the heavy-batch rule lives in the tool, and `npm test` was a
 * bare `node --test`). Runs the command after `heavyBatch` (see `heavy-batch.mjs`): caffeinated and thermal-checked on
 * the macOS laptop, with the 2-minute batch pause unless `--light`; on CI none of it applies. Inside a gate the gate's own
 * batch holds all of that, so this only runs the command.
 *
 *   node scripts/test-batch.mjs node --conditions development --test "tests/**\/*.test.mjs"
 *   node scripts/test-batch.mjs --light node --test tests/changesets.test.mjs     (one file: no pause)
 */
import { spawnSync } from 'node:child_process';
import { heavyBatch } from './heavy-batch.mjs';

const args = process.argv.slice(2);
const light = args[0] === '--light';
const [command, ...rest] = light ? args.slice(1) : args;
if (!command) throw new Error('usage: node scripts/test-batch.mjs [--light] <command> [args…]');
heavyBatch('tests', { pause: !light })();
const run = spawnSync(command, rest, { stdio: 'inherit', env: process.env });
if (run.error) throw run.error;
process.exit(run.status ?? 1);
