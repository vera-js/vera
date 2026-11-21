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
 */
import { spawn, spawnSync } from 'node:child_process';
import { holdHeavyLock } from './heavy-lock.mjs';

const LOCAL = process.platform === 'darwin' && !process.env.CI;
const pressure = () => Number(spawnSync('notifyutil', ['-g', 'com.apple.system.thermalpressurelevel'], { encoding: 'utf8' }).stdout?.trim().split(/\s+/)[1]);
const pauseS = (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

/** Starts the batch (caffeinate, the pause) and answers the per-step check: wait while thermal pressure is above 0. */
export const heavyBatch = (name, { pause = true } = {}) => {
  if (process.env.VERA_HEAVY_BATCH) return () => {};
  /** Every platform: one heavy job at a time (scripts/heavy-lock.mjs). Its children inherit the lock through the mark. */
  holdHeavyLock(name);
  process.env.VERA_HEAVY_BATCH = name;
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
