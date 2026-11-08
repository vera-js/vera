/**
 * **The race lock** (Brian, 2026-11-07): a timed run holds the machine-wide lock file (`RACE_LOCK`) (its pid, what it is, when it started) for as
 * long as it times, and removes it when it ends. The guard (`.probe/b1/no-race-running.sh`, and the `.probe/safe.sh`
 * wrapper for builds, typecheck and lint) refuses to run anything under a LIVE lock, so a check cannot slip into a timed
 * run (it did twice in one race cycle: a typecheck chained onto an edit). A lock whose pid is gone (a run killed by its
 * alarm or a crash) is STALE: the guard says so and clears it rather than blocking forever.
 */
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** ONE lock for the machine (2026-11-08): a race in any work tree blocks builds in every tree. `root` is kept for callers. */
export const RACE_LOCK = join(tmpdir(), 'vera-RACE.lock');
export const holdRaceLock = (_root, label) => {
  const file = RACE_LOCK;
  writeFileSync(file, `${process.pid} ${label} ${new Date().toISOString()}\n`);
  /** Only this run's own lock is removed: a second run's lock is never cleared by the first one ending. */
  const release = () => {
    try {
      if (readFileSync(file, 'utf8').startsWith(`${process.pid} `)) unlinkSync(file);
    } catch {
      /* already gone */
    }
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGALRM', 'SIGHUP'])
    process.on(signal, () => {
      release();
      process.exit(128);
    });
};
