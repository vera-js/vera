/**
 * **The small tiers through core's applicable suites** (Brian, 2026-11-19: lite and static go through every applicable
 * core/renderer suite before their first publish, and stay there). Runs each suite in `tests/tier-skips.mjs` under
 * `VERA_TIER=lite|static` (see `tests/dist.mjs`: the suites run against the tier's SHIPPED bundle), in the build `VERA_DIST`
 * names, WHOLE (Node leaves a `--test-skip-pattern` row out of its report entirely, so a skipped row could not be told
 * from a vanished one) — and fails on:
 *
 * - any row that fails and is not on the list for this build (a tier bug, or a harness gap: both are findings);
 * - any listed row that PASSES here (its allowance outlived its need) or no longer exists (the allowance rule);
 * - a suite that ran no row at all (a file that died at load reads as nothing, never as a pass).
 *
 *   node scripts/tier-suites.mjs                 # both tiers, development
 *   VERA_DIST=production node scripts/tier-suites.mjs
 *   node scripts/tier-suites.mjs lite            # one tier
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TIERS } from '../tests/tier-skips.mjs';
import { heavyBatch } from './heavy-batch.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const production = process.env.VERA_DIST === 'production';
const only = process.argv[2];
/** TAP escapes `#` and `\\` in a test's name; the list holds names as written. */
const unescape = (name) => name.replace(/\\([#\\])/g, '$1');
const cool = heavyBatch('tier-suites');

/**
 * A listed reason that names one build (`[development] …`, `[production] …`) applies to that build only: a development
 * diagnostic fails where it is said and skips itself in production, and a production-only row the reverse.
 */
const BUILD = production ? '[production]' : '[development]';
const appliesHere = (reason) => !/^\[(development|production)\]/.test(reason) || reason.startsWith(BUILD);

let failed = 0;
for (const [tier, { suites }] of Object.entries(TIERS)) {
  if (only !== undefined && tier !== only) continue;
  for (const [file, { skip = {} }] of Object.entries(suites)) {
    cool();
    /** The suite runs WHOLE: a listed row must still exist, still fail here, and fail for the listed reason's sake. */
    const args = [...(production ? [] : ['--conditions', 'development']), '--test', '--test-reporter=tap', `tests/${file}.test.mjs`];
    const run = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, VERA_TIER: tier }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const tap = run.stdout ?? '';
    /** Top-level rows only (TAP's subtests are indented); a row Node skipped itself (`# SKIP`) is neither pass nor fail. */
    const rows = [...tap.matchAll(/^(not ok|ok) \d+ - (.*?)( # SKIP.*)?$/gm)].map(([, verdict, name, skipped]) => ({ verdict, name: unescape(name), skipped: skipped !== undefined }));
    const problems = [];
    if (rows.length === 0) problems.push(`no row ran (exit ${run.status}): ${(run.stderr || tap).trim().split('\n').slice(-3).join(' | ')}`);
    for (const row of rows) {
      const reason = skip[row.name];
      const listed = reason !== undefined && appliesHere(reason);
      if (row.verdict === 'not ok' && !listed && !row.name.startsWith('tests/')) problems.push(`FAILED (not on the list): ${row.name}`);
      else if (row.verdict === 'not ok' && row.name.startsWith('tests/') && !listed) problems.push(`FAILED (the file): ${row.name}`);
      else if (row.verdict === 'ok' && !row.skipped && listed) problems.push(`PASSES NOW (remove its allowance): ${row.name}`);
    }
    for (const name of Object.keys(skip)) if (!rows.some((row) => row.name === name)) problems.push(`STALE (no such row): ${name}`);
    const allowed = rows.filter((row) => row.verdict === 'not ok').length;
    const passed = rows.filter((row) => row.verdict === 'ok' && !row.skipped).length;
    process.stdout.write(`  ${tier.padEnd(6)} ${file.padEnd(36)} ${problems.length ? '✗' : '✓'} ${passed} passed, ${allowed} failing with a listed reason\n`);
    for (const problem of problems) process.stdout.write(`      ${problem.slice(0, 220)}\n`);
    if (problems.length) failed++;
  }
}
if (failed) {
  process.stdout.write(`\n  ${failed} suite(s) failed under a tier.\n`);
  process.exit(1);
}
