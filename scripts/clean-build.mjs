/**
 * **A build from nothing — what CI does, so the gate can see a missing build dependency.**
 *
 *   node scripts/clean-build.mjs            build from nothing
 *   node scripts/clean-build.mjs --check    only ask whether a build is running in this tree
 *
 * `npm run build` is cached by wireit, and wireit keeps its state in each package's `.wireit` as well as the root: deleting
 * every `dist/` alone reports "Ran 0 scripts and skipped 26" and rebuilds nothing. A cached local build cannot see an
 * undeclared build edge — a package whose build needs another's output and does not say so passes here and fails on CI
 * (it hid `packages/ssr`'s missing dependency for months; three more were found on 2026-10-09). So this clears both
 * and builds. The gate runs it first (Brian, 2026-10-09).
 *
 * **Exclusive.** It deletes the `dist/` every suite reads, so nothing may build or test in this tree meanwhile. And it
 * refuses to start while any `wireit` or `rollup` process is alive: a killed build orphans them holding the build lock,
 * and the next build then deadlocks behind an owner that is gone (`98% [43 / 44] [0 running]`). It names them instead
 * — kill the stale ones (the START column) and run it again. VS Code's wireit extension server is not a build, and
 * neither is a build in ANOTHER tree (a worktree, the main checkout): wireit's lock is per tree, so only a process whose
 * working directory is inside this one counts (2026-10-09).
 */
import { spawnSync } from 'node:child_process';
import { globSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildProcesses } from './build-processes.mjs';
import { npmCommand } from './npm.mjs';
import { orphanOutputs, packageFiles } from './packages.mjs';
import { scratchLeftovers } from './scratch-dirs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const builds = buildProcesses(root);
if (builds.length) {
  console.error('A wireit or rollup process is alive — another build, or one a killed build orphaned:\n');
  console.error(builds.map((row) => `  ${row.trim().slice(0, 160)}`).join('\n'));
  console.error('\nWait for a live build to finish; kill a stale one (its START is older than any build you ran). Then rerun.');
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log('no build is running in this tree');
  process.exit(0);
}

/**
 * Every package's own cache and output, at any depth (`packages.mjs`), plus a cache one level inside a package, plus
 * the output left where a package used to be (`orphanOutputs`: a branch switch leaves a removed package's ignored
 * `dist/`, which a clean build that reads only packages never cleared), plus the scratch a killed suite left in the tree
 * (`scratchLeftovers`: a SIGKILL skips a suite's finally, and the next gate linted what it left). Nothing else runs in
 * this tree meanwhile (it is exclusive), so no live suite holds one.
 */
const orphans = orphanOutputs();
const scratch = scratchLeftovers();
const cleared = [...globSync('.wireit', { cwd: root }), ...packageFiles('.wireit'), ...packageFiles('*/.wireit'), ...packageFiles('dist'), ...orphans, ...scratch];
for (const path of cleared) rmSync(root + path, { recursive: true, force: true });
console.log(
  `cleared ${cleared.length} build directories${orphans.length ? ` (${orphans.length} left where no package is: ${orphans.join(', ')})` : ''}${scratch.length ? ` (${scratch.length} scratch left by a killed suite: ${scratch.join(', ')})` : ''}`
);

const started = Date.now();
const build = spawnSync(...npmCommand('npm', ['run', 'build']), { cwd: root, stdio: 'inherit' });
console.log(`clean build: exit ${build.status}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
process.exit(build.status ?? 1);
