/**
 * **A heavy batch is caffeinated, paused and thermal-gated — in the tool, never left to a launcher** (Brian, 2026-11-18;
 * CLAUDE.md). One copy, for every script that runs one (the gate, the coverage floor). On the fanless macOS laptop only
 * (CI runs on Linux, with neither `caffeinate` nor `notifyutil`): `caffeinate -dimsu -w` this process, so the screen
 * saver never comes on; a 2-minute pause before the batch starts (`BATCH_PAUSE_S`, default 120); and before every step
 * the caller marks with `cool()`, macOS's thermal pressure must be 0 — above it, pause a minute at a time until it
 * clears. A pressure that cannot be read refuses the batch rather than running it ungated.
 *
 *   const cool = heavyBatch('gate');   // caffeinate + the batch pause (macOS only)
 *   for (const step of steps) { cool(); … }
 *
 * A batch started INSIDE another (`npm test` as a gate step) inherits it: the outer batch sets `VERA_HEAVY_BATCH` for
 * its children, so the inner one neither pauses again nor starts a second caffeinate — the outer one holds both and
 * checks the pressure before each of its steps. `{ pause: false }` is for a light run (one file, a replay): caffeinated
 * and thermal-checked, never paused.
 *
 * On every platform but CI the batch also holds the machine-wide heavy lock (`scripts/heavy-lock.mjs`) for its life,
 * waiting while another live batch holds it; a light run takes it too, since a check inside a timed run is what the
 * lock exists to stop. Its children inherit it through `VERA_HEAVY_BATCH`, set on every platform.
 *
 * **On Windows** (2026-11-26, not CI): no thermal reading and no pause, but the same two guards a headed run needs. The
 * machine is held awake for the batch's life through `SetThreadExecutionState` (system and display required, by a hidden
 * PowerShell that waits on this process, as `caffeinate -w` does), and a LOCKED session is refused: with the lock screen
 * up (`LogonUI.exe` running), headed WebKit read single reds and a creation reading that did not reproduce unlocked
 * (four WebKit reds in one day, all while locked). The batch refuses to start locked, and a step that ENDS locked fails:
 * every `cool(step)` after the first is the end of the step before it, and the batch's exit is the end of its last
 * (a lock then sets the exit code to 1): "<step> ended with the session locked — its readings are not trusted; re-run
 * it". A lock state that cannot be read fails the same way. The limit: a lock undone before its step ends is not seen
 * (the awake hold prevents an idle lock, so only a manual lock and unlock inside one step can be).
 */
import { spawn, spawnSync } from 'node:child_process';
import { holdHeavyLock } from './heavy-lock.mjs';

const LOCAL = process.platform === 'darwin' && !process.env.CI;
const WINDOWS = process.platform === 'win32' && !process.env.CI;
const pressure = () => Number(spawnSync('notifyutil', ['-g', 'com.apple.system.thermalpressurelevel'], { encoding: 'utf8' }).stdout?.trim().split(/\s+/)[1]);
const pauseS = (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

/**
 * Whether a `tasklist /FI "IMAGENAME eq LogonUI.exe" /NH` listing shows the lock screen: `true` when `LogonUI.exe` is
 * listed, `false` when tasklist answered with no such task, `undefined` when the listing is neither (unreadable).
 *
 * @param {string | undefined} listing tasklist's standard output
 * @returns {boolean | undefined}
 */
export const lockedFrom = (listing) => {
  if (typeof listing !== 'string' || listing.trim() === '') return undefined;
  if (/^\s*logonui\.exe\s/im.test(listing)) return true;
  return /no tasks are running/i.test(listing) ? false : undefined;
};
const sessionLocked = () => lockedFrom(spawnSync('tasklist', ['/FI', 'IMAGENAME eq LogonUI.exe', '/NH'], { encoding: 'utf8' }).stdout);
/**
 * The command that holds a Windows machine awake while process `pid` lives: `SetThreadExecutionState` with
 * `ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED` (0x80000003) on a PowerShell thread that then waits on `pid`;
 * the state ends with that thread.
 *
 * @param {number} pid The batch's process
 * @returns {[string, string[]]}
 */
export const awakeCommand = (pid) => [
  'powershell',
  [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-Command',
    `Add-Type -Namespace Vera -Name Awake -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; [void][Vera.Awake]::SetThreadExecutionState(0x80000003); Wait-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue`,
  ],
];

/** Starts the batch (caffeinate, the pause) and answers the per-step check: wait while thermal pressure is above 0. */
export const heavyBatch = (name, { pause = true } = {}) => {
  if (process.env.VERA_HEAVY_BATCH) return () => {};
  /** Every platform: one heavy job at a time (scripts/heavy-lock.mjs). Its children inherit the lock through the mark. */
  holdHeavyLock(name);
  process.env.VERA_HEAVY_BATCH = name;
  if (WINDOWS) {
    const locked = sessionLocked();
    if (locked === undefined) throw new Error(`${name}: the session's lock state could not be read (tasklist) — refusing to run unguarded`);
    if (locked) throw new Error(`${name}: the session is locked (LogonUI.exe is running) — headed readings are not trusted while locked; unlock it, or set it not to lock while unattended`);
    const [file, args] = awakeCommand(process.pid);
    spawn(file, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    /** Why a step that just ended cannot be trusted, or `undefined` when the session is unlocked. */
    const endedLocked = () => {
      const now = sessionLocked();
      return now === false ? undefined : now ? 'ended with the session locked' : "ended with the session's lock state unreadable (tasklist)";
    };
    /** The step now running, named by the caller's `cool(step)`; `undefined` before the first. */
    let running;
    process.on('exit', () => {
      const why = running === undefined ? undefined : endedLocked();
      if (why === undefined) return;
      process.stderr.write(`${name}: ${running} ${why} — its readings are not trusted; re-run it\n`);
      process.exitCode = 1;
    });
    return (step = name) => {
      const why = running === undefined ? undefined : endedLocked();
      if (why !== undefined) throw new Error(`${name}: ${running} ${why} — its readings are not trusted; re-run it`);
      running = step;
    };
  }
  if (!LOCAL) return () => {};
  spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
  if (!Number.isInteger(pressure())) throw new Error(`${name}: the thermal pressure level could not be read — refusing to run ungated`);
  const batchPause = pause ? Number(process.env.BATCH_PAUSE_S ?? 120) : 0;
  if (batchPause > 0) {
    process.stdout.write(`  (batch pause: ${batchPause} s before the first step)\n`);
    pauseS(batchPause);
  }
  return () => {
    while (pressure() > 0) {
      process.stdout.write(`  (thermal ${pressure()}: pausing 60 s)\n`);
      pauseS(60);
    }
  };
};
