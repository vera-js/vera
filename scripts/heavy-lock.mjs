/**
 * **One heavy job at a time, held by the tool, not by convention** (CLAUDE.md §3; 2026-11-21). Every heavy batch (the
 * gate, test-batch, tier suites, the coverage floor) holds the machine-wide lock directory `vera-heavy.lock` in the
 * system temp directory for as long as it runs. Until now only hand-written scripts made it: the gate never did, so
 * every gate on the Windows workstation ran with the directory absent, and two sessions were kept apart only by their
 * messages. `mkdir` is the atomic step, which is also how the shell scripts take it, so one convention covers both.
 *
 * The directory holds `owner` (what holds it, since when), `pid` (the holding process) and `heartbeat`. A holder is
 * judged by its pid ALONE: live while the pid answers a signal-0 probe (`process.kill(pid, 0)`, which works on Windows;
 * EPERM means it runs under another user and counts as live). Not "pid and a fresh heartbeat": a node batch's steps are
 * `spawnSync`, so its event loop, and with it the heartbeat, is stopped for minutes while it is very much alive. **A
 * shell script that takes the lock writes its WINDOWS pid** to `pid`: on Git Bash `$$` is an MSYS pid that no Windows
 * process has, so write `cat /proc/$$/winpid` (and `$$` on macOS and Linux). Only a holder with no `pid` at all is
 * judged by its heartbeat, live while it is under 60 s old, so such a script must beat in the background. The heartbeat
 * is otherwise for people reading the lock. **A script that takes the lock by hand and then runs test-batch or the gate
 * must `export VERA_HEAVY_BATCH=<name>` after its mkdir**: those tools take the lock themselves, and without the mark
 * they wait forever on the script's own lock.
 *
 * A process that finds the lock held waits, saying who holds it, again every 5 minutes with its age, so a wait behind
 * a hung holder shows in the log. A STALE lock (its holder gone: a run killed by an alarm, a crash) is taken over
 * atomically: the taker renames the directory aside, and only one rename can succeed; it then checks the renamed lock
 * is still the stale one it judged, and puts it back if another process took the lock in between. Only the holder
 * removes its own lock. Known limit: a dead holder's pid reused by an unrelated process reads as live until that
 * process ends; the waiting message names the pid, so a person can see it.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The lock's path: one per machine. `VERA_HEAVY_LOCK` moves it, for the suite that tests it. */
export const heavyLockPath = () => process.env.VERA_HEAVY_LOCK ?? join(tmpdir(), 'vera-heavy.lock');

/** How long a pid-less holder's heartbeat stays fresh: three 20 s beats. */
const FRESH_MS = 60_000;
/** How often a waiter names the holder again. */
const REPORT_MS = 5 * 60_000;
const waitMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const read = (file) => {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
};
const mtime = (path) => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
};

/** Whether `pid` names a running process. */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/** What holds the lock at `dir`: `{ owner, pid, live, since }`, or null when nothing does. */
export const holderOf = (dir) => {
  const since = mtime(dir);
  if (since === null) return null;
  const owner = read(join(dir, 'owner')) ?? '(no owner written yet)';
  const pid = Number(read(join(dir, 'pid'))) || null;
  const beat = mtime(join(dir, 'heartbeat')) ?? since;
  const live = pid !== null ? alive(pid) : Date.now() - beat < FRESH_MS;
  return { owner, pid, live, since };
};

/**
 * Takes over the lock at `dir` that was judged stale as `judged`, atomically. Answers whether it was cleared; false
 * means another process got there first, and the caller simply tries again.
 */
const clearStale = (dir, judged) => {
  const aside = `${dir}.stale-${process.pid}`;
  try {
    renameSync(dir, aside);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EPERM' || error.code === 'EEXIST' || error.code === 'ENOTEMPTY') return false;
    throw error;
  }
  const moved = holderOf(aside);
  if (moved !== null && moved.pid === judged.pid && !moved.live) {
    rmSync(aside, { recursive: true, force: true });
    return true;
  }
  /**
   * Another process took the lock between our read and our rename: give it back if its place is still free. If a third
   * process took the place meanwhile, the aside copy is LEFT where it is: it names a holder that is still running (two
   * jobs now run at once, which mkdir locks cannot fully rule out), so a person can find its owner and pid.
   */
  try {
    renameSync(aside, dir);
  } catch {
    process.stdout.write(`  (heavy lock: a live holder's lock was displaced to ${aside} — ${moved?.owner ?? 'unknown owner'}; two jobs may be running)\n`);
  }
  return false;
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
  let reported = 0;
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
      if (clearStale(dir, holder))
        process.stdout.write(`  (heavy lock: cleared a stale lock — ${holder.owner}${holder.pid ? `, pid ${holder.pid} gone` : ', heartbeat old'})\n`);
      continue;
    }
    if (Date.now() - reported >= REPORT_MS) {
      const age = Math.round((Date.now() - holder.since) / 60_000);
      process.stdout.write(`  (heavy lock: waiting for ${holder.owner}${holder.pid ? `, pid ${holder.pid}` : ''}; held ${age} min)\n`);
      reported = Date.now();
    }
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
    if (Number(read(join(dir, 'pid'))) === process.pid) rmSync(dir, { recursive: true, force: true });
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, () => {
      release();
      process.exit(128);
    });
  return waited;
};
