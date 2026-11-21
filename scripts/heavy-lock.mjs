/**
 * **One heavy job at a time, held by the tool, not by convention** (CLAUDE.md §3; 2026-11-21). Every heavy batch (the
 * gate, test-batch, tier suites, the coverage floor) holds the machine-wide lock directory `vera-heavy.lock` in the
 * system temp directory for as long as it runs. Until now only hand-written scripts made it: the gate never did, so
 * every gate on the Windows workstation ran with the directory absent, and two sessions were kept apart only by their
 * messages. `mkdir` is the atomic step, which is also how the shell scripts take it, so one convention covers both.
 *
 * The directory holds `owner` (what holds it, since when), `pid` (the holding process) and `heartbeat` (rewritten every
 * 20 s while it is held). A process that finds it held waits, saying once who holds it, and takes it when it is free. A
 * holder is LIVE while its pid answers, or, for a shell script that writes no `pid`, while its heartbeat is under 60 s
 * old; otherwise the lock is STALE (a run killed by an alarm, a crash) and is taken over, never waited on forever. Only
 * the holder's own lock is removed when it ends.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The lock's path: one per machine. `VERA_HEAVY_LOCK` moves it, for the suite that tests it. */
export const heavyLockPath = () => process.env.VERA_HEAVY_LOCK ?? join(tmpdir(), 'vera-heavy.lock');

/** How long a shell holder's heartbeat stays fresh: three of its 20 s beats. */
const FRESH_MS = 60_000;
const waitMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Whether `pid` names a running process (a signal-0 probe: EPERM means it runs under another user). */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/** Read what holds the lock at `dir`, or null when nothing does. */
export const holderOf = (dir) => {
  let owner;
  try {
    owner = readFileSync(join(dir, 'owner'), 'utf8').trim();
  } catch {
    try {
      statSync(dir);
    } catch {
      return null;
    }
    owner = '(no owner written yet)';
  }
  let pid = null;
  try {
    pid = Number(readFileSync(join(dir, 'pid'), 'utf8').trim()) || null;
  } catch {
    /* a shell holder writes no pid */
  }
  let beat = 0;
  try {
    beat = statSync(join(dir, 'heartbeat')).mtimeMs;
  } catch {
    try {
      beat = statSync(dir).mtimeMs;
    } catch {
      return null;
    }
  }
  const live = pid !== null ? alive(pid) : Date.now() - beat < FRESH_MS;
  return { owner, pid, live };
};

/**
 * Takes the lock for `name` and holds it until this process ends, waiting while a live holder has it. Answers whether
 * this process had to wait. A batch started inside another inherits its lock (`VERA_HEAVY_BATCH`), and CI, one job per
 * runner, takes none.
 */
export const holdHeavyLock = (name) => {
  if (process.env.CI || process.env.VERA_HEAVY_BATCH) return false;
  const dir = heavyLockPath();
  let waited = false;
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = holderOf(dir);
    if (holder === null) continue; // released between the mkdir and the read: try again
    if (!holder.live) {
      process.stdout.write(`  (heavy lock: clearing a stale lock — ${holder.owner}${holder.pid ? `, pid ${holder.pid} gone` : ', heartbeat old'})\n`);
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    if (!waited) process.stdout.write(`  (heavy lock: waiting for ${holder.owner}${holder.pid ? `, pid ${holder.pid}` : ''})\n`);
    waited = true;
    waitMs(2000);
  }
  writeFileSync(join(dir, 'pid'), `${process.pid}\n`);
  writeFileSync(join(dir, 'owner'), `${name} (pid ${process.pid}, ${process.cwd()}), started ${new Date().toISOString()}\n`);
  const beat = () => writeFileSync(join(dir, 'heartbeat'), `${new Date().toISOString()}\n`);
  beat();
  setInterval(beat, 20_000).unref();
  /** Only this process's own lock is removed: a lock another process took over after us is not ours to clear. */
  const release = () => {
    try {
      if (Number(readFileSync(join(dir, 'pid'), 'utf8').trim()) === process.pid) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, () => {
      release();
      process.exit(128);
    });
  return waited;
};
