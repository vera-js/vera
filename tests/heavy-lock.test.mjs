/**
 * The heavy lock (`scripts/heavy-lock.mjs`): held for a batch's life, waited on while a live process holds it, taken
 * over when its holder is gone, inherited by a nested batch, and removed only by its own holder. Each row runs child
 * processes against a lock path of its own (`VERA_HEAVY_LOCK`), so it never touches the machine's real lock, with the
 * CI mark cleared (the lock is not taken on CI, and this suite runs there). About 6 s.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holderOf } from '../scripts/heavy-lock.mjs';

const MODULE = new URL('../scripts/heavy-lock.mjs', import.meta.url).href;
const scratch = () => mkdtempSync(join(tmpdir(), 'heavy-lock-'));
const env = (lock, extra = {}) => ({ ...process.env, CI: '', VERA_HEAVY_BATCH: '', VERA_HEAVY_LOCK: lock, ...extra });
/** A child that takes the lock, then runs `then` (module source), then ends. */
const childSource = (then) => `const { holdHeavyLock } = await import(${JSON.stringify(MODULE)}); const waited = holdHeavyLock('row'); ${then}`;
const runChild = (lock, then, extra) => spawnSync(process.execPath, ['--input-type=module', '-e', childSource(then)], { env: env(lock, extra), encoding: 'utf8' });
const hold = (ms) => `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});`;

test('a batch holds the lock while it runs and removes it when it ends', () => {
  const lock = join(scratch(), 'vera-heavy.lock');
  const child = runChild(lock, `const fs = await import('node:fs'); console.log(JSON.stringify({ held: fs.existsSync(${JSON.stringify(lock)}), pid: fs.readFileSync(${JSON.stringify(join(lock, 'pid'))}, 'utf8').trim(), waited }));`);
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.equal(report.held, true, 'held while it ran');
  assert.equal(report.waited, false, 'a free lock is taken without waiting');
  assert.ok(Number(report.pid) > 0, 'it wrote its pid');
  assert.equal(existsSync(lock), false, 'removed when it ended');
});

test('a second batch waits while a live one holds the lock, then takes it', async () => {
  const lock = join(scratch(), 'vera-heavy.lock');
  const holder = spawn(process.execPath, ['--input-type=module', '-e', childSource(`console.log('held'); ${hold(1500)}`)], { env: env(lock), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => holder.stdout.once('data', resolve)); // the holder has it
  const start = Date.now();
  const waiter = runChild(lock, "console.log(JSON.stringify({ waited }));");
  const took = Date.now() - start;
  assert.equal(waiter.status, 0, waiter.stderr);
  assert.equal(JSON.parse(waiter.stdout.trim().split('\n').at(-1)).waited, true, 'it waited');
  assert.match(waiter.stdout, /heavy lock: waiting for row \(pid \d+.*held \d+ min/, 'and said who it waited for, and for how long');
  assert.ok(took >= 800, `CONTROL: it did not proceed while the holder ran (${took} ms)`);
  await new Promise((resolve) => holder.once('exit', resolve));
});

test('a lock whose holder is gone is taken over, not waited on', () => {
  const lock = join(scratch(), 'vera-heavy.lock');
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  const deadPid = Number(gone.stdout.trim());
  mkdirSync(lock);
  writeFileSync(join(lock, 'pid'), `${deadPid}\n`);
  writeFileSync(join(lock, 'owner'), 'a killed gate\n');
  assert.equal(holderOf(lock).live, false, 'CONTROL: the planted holder reads as gone');
  const child = runChild(lock, "console.log(JSON.stringify({ waited }));");
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout.trim().split('\n').at(-1)).waited, false);
  assert.match(child.stdout, /cleared a stale lock — a killed gate, pid \d+ gone/);
});

/**
 * **Two takers of one stale lock leave exactly one holder** (the race a plain rm-then-mkdir loses: both judge it stale,
 * one takes the fresh lock, the other deletes it on its old judgement). Each child holds for 600 ms and reports when it
 * held; the two holds must not overlap.
 */
test('two processes that find the same stale lock never hold it at once', async () => {
  const lock = join(scratch(), 'vera-heavy.lock');
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  mkdirSync(lock);
  writeFileSync(join(lock, 'pid'), `${gone.stdout.trim()}\n`);
  const taker = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', childSource(`const from = Date.now(); ${hold(600)} console.log(JSON.stringify({ from, to: Date.now() }));`)], { env: env(lock), stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.once('exit', (code) => resolve({ code, held: JSON.parse(out.trim().split('\n').at(-1)) }));
    });
  const [a, b] = await Promise.all([taker(), taker()]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  const [first, second] = [a.held, b.held].sort((x, y) => x.from - y.from);
  assert.ok(second.from >= first.to, `the holds overlapped: ${JSON.stringify([first, second])}`);
  assert.equal(existsSync(lock), false, 'and the last holder removed it');
});

test("a shell script's lock (no pid) is live while its heartbeat is fresh, stale once it is old", () => {
  const lock = join(scratch(), 'vera-heavy.lock');
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), 'bytes7.sh\n');
  writeFileSync(join(lock, 'heartbeat'), 'now\n');
  assert.equal(holderOf(lock).live, true, 'a fresh heartbeat');
  const old = (Date.now() - 120_000) / 1000;
  utimesSync(join(lock, 'heartbeat'), old, old);
  assert.equal(holderOf(lock).live, false, 'a two-minute-old heartbeat');
  assert.equal(holderOf(join(lock, 'absent')), null, 'no lock, no holder');
});

test('a batch inside a batch inherits the lock, and only a holder removes its own lock', () => {
  const lock = join(scratch(), 'vera-heavy.lock');
  const nested = runChild(lock, `const fs = await import('node:fs'); console.log(JSON.stringify({ waited, made: fs.existsSync(${JSON.stringify(lock)}) }));`, { VERA_HEAVY_BATCH: 'gate' });
  assert.equal(nested.status, 0, nested.stderr);
  assert.deepEqual(JSON.parse(nested.stdout.trim().split('\n').at(-1)), { waited: false, made: false }, 'a nested batch neither waits nor takes the lock');
  /** A holder whose lock was taken over (its pid file now names another process) leaves that lock alone. */
  const other = runChild(lock, `const fs = await import('node:fs'); fs.writeFileSync(${JSON.stringify(join(lock, 'pid'))}, '${process.pid}\\n');`);
  assert.equal(other.status, 0, other.stderr);
  assert.equal(existsSync(lock), true, "the lock another process now holds was not removed");
  assert.equal(readFileSync(join(lock, 'pid'), 'utf8').trim(), String(process.pid));
  rmSync(lock, { recursive: true, force: true });
});
