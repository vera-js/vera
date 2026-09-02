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
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const steps = [
  ['sync-packages', 'npm', ['run', 'check']],
  ['tag-release', 'node', ['scripts/tag-release.mjs', '--check']],
  /**
   * **Before `typecheck`, because `typecheck`'s last pass reads generated files.**
   *
   * `scripts/typecheck.mjs` ends with `tests/consumer`, which resolves imports through each
   * package's `exports` → `types` exactly as npm does — and so reads `dist/development/*.d.ts` and
   * `packages/ssr/types/*.d.ts`. The script's own comment says that pass "requires a build"; the
   * gate did not do one, so it checked whatever declarations happened to be on disk.
   *
   * That fails safely in one direction and not the other. A *stale* declaration that is worse than
   * the source makes the gate fail for no reason, which is how this was noticed. A stale declaration
   * that is **better** than the source makes the gate pass over a real regression — demonstrated by
   * removing a `@template` annotation from `@verajs/ssr`, which turns both entry points into
   * `Promise<void>` for every consumer, and watching all twelve configs report clean.
   *
   * Wireit caches this, so when nothing has changed it costs a few seconds and the rest of the gate
   * was going to need it anyway.
   */
  ['build', 'npm', ['run', 'build']],
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
  /**
   * @verajs/ui's surface contract: custom-elements.json must match the declared surfaces
   * (`src/x/surface.ts`) — a component API change without its manifest diff refuses here, which
   * is what makes the manifest a gate rather than a promise. The runtime half (rendered DOM
   * matches the declaration) lives in tests/ui-surface.test.mjs.
   */
  ['ui manifest', 'node', ['packages/ui/scripts/generate-manifest.mjs', '--check']],
  ['node (development)', 'npm', ['test']],
  ['node (production)', 'npm', ['run', 'test:prod']],
  /**
   * @verajs/motion's own gate — audit rules, reference drift, built-declaration consumer, the
   * built-artifact wiring check, doc examples through the real parser, and its suite under
   * node --test. The package migrated in with its gate intact (2026-09-01); running it here
   * is what makes the migration's "nothing weakened" claim a checked one.
   */
  ['motion check', 'npm', ['run', 'check', '-w', '@verajs/motion']],
  ['browser × 3', 'npm', ['run', 'test:browser:all']],
];

/**
 * Lines worth surfacing from anywhere in a failed step's output, not just the end of it.
 *
 * The tail is the right default — most tools put their summary last — but `@web/test-runner` does
 * not: it prints a session's error **above** the per-browser progress bars and the final summary. So
 * for two occurrences of the random browser failure the one line naming the cause was pushed out of
 * a twelve-line tail, and the flake stayed undiagnosed for want of output that had existed and been
 * discarded. A gate that reports a failure it has made unreadable is most of the way to a gate that
 * reports nothing.
 */
const NOTABLE = /\berror\b|timed out|timeout|did not (start|finish)|unable to (create|start)|unhandled|uncaught/i;

/** Kept out of the repo: files appearing and vanishing in the tree are what broke `tests/walk.mjs`. */
const logPath = (name) => join(tmpdir(), `vera-gate-${name.replace(/[^a-z0-9]+/gi, '-')}-${process.pid}.log`);

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

  const full = ((run.stdout ?? '') + (run.stderr ?? '')).trimEnd();
  const lines = full.split('\n');
  const tail = lines.slice(-12);

  /** Deduped against the tail, so a summary line that already prints is not repeated. */
  const seen = new Set(tail);
  const notable = lines.filter((line) => NOTABLE.test(line) && !seen.has(line)).slice(0, 10);
  if (notable.length) {
    console.log('      — elsewhere in the output —');
    console.log(notable.map((line) => `      ${line}`).join('\n'));
    console.log('      — end of output —');
  }

  console.log(tail.map((line) => `      ${line}`).join('\n'));

  /** The whole thing, always, because the two filters above are guesses and the file is not. */
  const path = logPath(name);
  try {
    writeFileSync(path, full);
    console.log(`      full output: ${path}`);
  } catch (error) {
    console.log(`      (could not write the full output: ${error.message})`);
  }
}

console.log(failed ? `\n  ${failed} step(s) failed.` : '\n  gate clean.');
process.exit(failed ? 1 : 0);
