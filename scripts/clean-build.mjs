/**
 * **A build from nothing — what CI does, so the gate can see a missing build dependency.**
 *
 *   node scripts/clean-build.mjs            build from nothing
 *   node scripts/clean-build.mjs --check    only ask whether a build is running in this tree
 *
 * `npm run build` is cached by wireit, and wireit keeps its state in `packages/*\/.wireit` as well as the root: deleting
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
 * working directory is inside this one counts (vera-5a, 2026-10-09).
 */
import { execSync, spawnSync } from 'node:child_process';
import { globSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** A process's working directory, or null once it has gone. */
const cwdOf = (pid) => {
  try {
    return execSync(`lsof -a -p ${pid} -d cwd -Fn`, { encoding: 'utf8' }).split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? null;
  } catch {
    return null;
  }
};
const inTree = (dir) => dir !== null && (dir + '/').startsWith(root);
const builds = execSync('ps -Ao pid,lstart,command', { encoding: 'utf8' })
  .split('\n')
  .slice(1)
  .filter((row) => /\b(wireit|rollup)\b/.test(row) && !/\.vscode|extensions\/|clean-build\.mjs/.test(row))
  .filter((row) => inTree(cwdOf(row.trim().split(/\s+/)[0])));
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

const cleared = globSync(['.wireit', 'packages/*/.wireit', 'packages/*/*/.wireit', 'packages/*/dist'], { cwd: root });
for (const path of cleared) rmSync(root + path, { recursive: true, force: true });
console.log(`cleared ${cleared.length} build directories`);

const started = Date.now();
const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
console.log(`clean build: exit ${build.status}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
process.exit(build.status ?? 1);
