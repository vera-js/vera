/**
 * The whole gate, in one command, exiting nonzero if anything fails.
 *
 *   node scripts/gate.mjs
 *
 * Written after a commit went out with a failing `typecheck`: the ad-hoc shell loop being used
 * printed a ✗ and then carried on to `git commit`, because nothing consumed its result. A gate that
 * reports failure without preventing anything is not a gate.
 *
 * Mirrors `ci.yml` so a green run here means a green run there.
 */
import { spawnSync } from 'node:child_process';

const steps = [
  ['sync-packages', 'npm', ['run', 'check']],
  ['tag-release', 'node', ['scripts/tag-release.mjs', '--check']],
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['eslint', 'npx', ['eslint', '.']],
  ['size claims', 'node', ['scripts/sync-size-claims.mjs', '--check']],
  ['hydration fixture', 'node', ['scripts/build-hydration-fixture.mjs', '--check']],
  /**
   * **Its sibling was in this list and it was not, and it had drifted.** The browser suite compares
   * three renderings of the kitchen sink against committed markup, and `@verajs/ssr` is Node-only so
   * that markup cannot be produced in the browser. With nothing checking it, a fix to the server
   * left the fixture behind and 35 browser files went on asserting against markup no server emits —
   * green the whole time, which is the exact failure the script's own header says it exists to
   * prevent.
   */
  ['kitchen fixture', 'node', ['scripts/build-kitchen-fixture.mjs', '--check']],
  ['node (development)', 'npm', ['test']],
  ['node (production)', 'npm', ['run', 'test:prod']],
  ['browser × 3', 'npm', ['run', 'test:browser:all']],
];

let failed = 0;
for (const [name, command, args] of steps) {
  process.stdout.write(`  ${name.padEnd(22)}`);
  const run = spawnSync(command, args, { encoding: 'utf8' });
  if (run.status === 0) {
    console.log('✓');
    continue;
  }
  failed++;
  console.log('✗');
  const output = ((run.stdout ?? '') + (run.stderr ?? '')).trimEnd().split('\n').slice(-12);
  console.log(output.map((line) => `      ${line}`).join('\n'));
}

console.log(failed ? `\n  ${failed} step(s) failed.` : '\n  gate clean.');
process.exit(failed ? 1 : 0);
