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
import { npmCommand } from './npm.mjs';
import { join } from 'node:path';
import { heavyBatch } from './heavy-batch.mjs';
import { canonicalCwd } from './fs-path.mjs';

/** Every child inherits the canonical cwd, whichever shell launched this (scripts/fs-path.mjs). */
canonicalCwd();

const steps = [
  ['sync-packages', 'npm', ['run', 'check']],
  ['tag-release', 'node', ['scripts/tag-release.mjs', '--check']],
  ['publishers', 'node', ['scripts/check-publishers.mjs']],
  /**
   * **Before `typecheck`, because `typecheck`'s last pass reads generated files.**
   *
   * `scripts/typecheck.mjs` ends with `tests/consumer`, which resolves imports through each
   * package's `exports` → `types` exactly as npm does — and so reads `dist/development/*.d.ts` and
   * `packages/ssr/dist/vera/*.d.ts`. The script's own comment says that pass "requires a build"; the
   * gate did not do one, so it checked whatever declarations happened to be on disk.
   *
   * That fails safely in one direction and not the other. A *stale* declaration that is worse than
   * the source makes the gate fail for no reason, which is how this was noticed. A stale declaration
   * that is **better** than the source makes the gate pass over a real regression — demonstrated by
   * removing a `@template` annotation from `@verajs/ssr`, which turns both entry points into
   * `Promise<void>` for every consumer, and watching all twelve configs report clean.
   *
   * **From nothing** (Brian, 2026-10-09): `scripts/clean-build.mjs` clears every `.wireit` and `dist/` first, as CI
   * starts — a cached build cannot see an undeclared build edge, and four were found that way. It deletes what every
   * later step reads, so the gate is EXCLUSIVE: nothing else may build or test in this tree while it runs.
   */
  ['clean build (exclusive)', 'node', ['scripts/clean-build.mjs']],
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['eslint', 'npx', ['eslint', '.']],
  ['size claims', 'node', ['scripts/sync-size-claims.mjs', '--check']],
  ['diagnostics', 'node', ['scripts/sync-diagnostics.mjs', '--check']],
  ['entity table', 'node', ['scripts/gen-entities.mjs', '--check']],
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
  /** The components page is generated from every package's demo.ts and committed, so the browser suite operates it as
   *  a static page: drift means it shows states or components the source no longer has. */
  ['components page', 'node', ['scripts/build-components-page.mjs', '--check']],
  /** Same rule, same day it was written: the motion SSR fixture is real renderMotion output the
   *  browser handoff suite paints against, so drift here means the suite hydrates markup no
   *  server emits. Needs the development condition like every fixture script. */
  ['motion fixture', 'node', ['--conditions', 'development', 'scripts/build-motion-fixture.mjs', '--check']],
  /**
   * Every component's surface contract: each custom-elements.json must match its declared surfaces
   * (every `surface.ts` under `src/`), for every package that declares `customElements` — a component API change
   * without its manifest diff refuses here, which is what makes the manifest a gate rather than a
   * promise. The runtime half (rendered DOM matches the declaration) lives in each component's
   * surface suite (tests/select-surface.test.mjs).
   */
  ['custom-elements manifests', 'node', ['scripts/generate-cem.mjs', '--check']],
  ['node (development)', 'npm', ['test']],
  ['node (production)', 'npm', ['run', 'test:prod']],
  /** The NODE builds — what Node and Vite load through a `node` export condition (minified, __DEV__ true): jsx's
   *  compiler and cms's content. Third programs, so their suites run against them too (2026-10-09). */
  ['node (node builds)', 'npm', ['run', 'test:node-builds']],
  /**
   * **The small tiers through core's applicable suites** (Brian, 2026-11-19): every suite in `tests/tier-skips.mjs`
   * under `VERA_TIER=lite|static`, against each tier's shipped bundle — a row that fails and is not on the list, or a
   * listed skip that names no row, fails the step.
   */
  ['tier suites (development)', 'npm', ['run', 'test:tiers']],
  ['tier suites (production)', 'npm', ['run', 'test:tiers:prod']],
  /**
   * **A server suite must see what it asserts is absent** (Brian approved, 2026-11-17): the SSR suites run under an
   * instrument that records a query coming back empty while a `<template>` holds a match — a served shadow root parses as
   * one in jsdom, and a security suite had searched an empty document on every run. ≈ 9 s.
   */
  ['blind queries', 'node', ['scripts/blind-queries.mjs']],
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

/** The gate is a heavy batch: caffeinated, paused and thermal-gated before every step (see `heavy-batch.mjs`). */
const cool = heavyBatch('gate');

let failed = 0;
for (const [name, command, args] of steps) {
  cool(name);
  process.stdout.write(`  ${name.padEnd(26)}`);
  /**
   * A buffer far above any step's output (2026-11-17): at spawnSync's default 1 MiB, the development suite's output
   * (1.05 MB) got the step KILLED mid-run, and its log simply stopped, with no summary and no cause. A spawn error is
   * printed as the step's first line, so a killed or unstartable step names why.
   */
  /** npm and npx through `npmCommand`, which Windows needs (`scripts/npm.mjs`); everything else as named. */
  const [file, argv] = command === 'npm' || command === 'npx' ? npmCommand(command, args) : [command, args];
  const run = spawnSync(file, argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.status === 0) {
    console.log('✓');
    continue;
  }
  failed++;
  console.log('✗');
  if (run.error) console.log(`      spawn: ${run.error.code ?? ''} ${run.error.message}`);

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
