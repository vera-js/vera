/**
 * **`heavyBatch` on Windows** (2026-11-26): the machine is held awake through `SetThreadExecutionState` for the batch's
 * life, a locked session (`LogonUI.exe` running) is refused, and a step that ends locked fails, because headed WebKit
 * read single reds and a creation reading that did not reproduce unlocked, all while the session was locked. Run on any
 * platform: a child process sees `process.platform` as `win32`, and a temporary directory first on its `PATH` holds a
 * `tasklist` that prints a chosen listing and a `powershell` that records its arguments, so the rows read what the batch
 * DID, not what it says.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const { awakeCommand, lockedFrom } = await import(new URL('scripts/heavy-batch.mjs', ROOT).href);

const LOCKED = '\r\nLogonUI.exe                  11234 Console                    1     41,224 K\r\n';
const UNLOCKED = 'INFO: No tasks are running which match the specified criteria.\r\n';

test('lockedFrom reads tasklist: listed is locked, "no tasks" is unlocked, anything else is unreadable', () => {
  assert.equal(lockedFrom(LOCKED), true);
  assert.equal(lockedFrom('logonui.EXE  1 Console 1 9 K'), true, 'any case');
  assert.equal(lockedFrom(UNLOCKED), false);
  assert.equal(lockedFrom('LogonUIx.exe  1 Console 1 9 K'), undefined, 'another image is not the lock screen');
  for (const listing of [undefined, '', '   \r\n', 'ERROR: Invalid argument/option', 'INFORMATION : Aucune tâche'])
    assert.equal(lockedFrom(listing), undefined, JSON.stringify(listing));
});

test('awakeCommand holds the system and display awake until the given process exits, and takes the pid as a number only', () => {
  const [file, args] = awakeCommand(4242);
  assert.equal(file, 'powershell');
  const script = args.at(-1);
  assert.match(script, /SetThreadExecutionState\(0x80000003\)/);
  assert.match(script, /Wait-Process -Id 4242 /);
  assert.ok(args.includes('-NonInteractive') && args.includes('Hidden'));
  assert.match(awakeCommand('7; Remove-Item C:\\').at(-1).at(-1), /Wait-Process -Id NaN /, 'a non-number never reaches the script');
});

/**
 * Runs `heavyBatch('row')` in a child that sees win32, with the fake tools on PATH; answers what happened. `steps` is
 * the child's code after the start, with `cool` (the step function) and `lockState(text)` (what tasklist prints next).
 */
const runAsWindows = (listing, steps = '') => {
  const dir = mkdtempSync(join(tmpdir(), 'vera-heavy-win-'));
  try {
    const record = join(dir, 'powershell-args.json');
    writeFileSync(join(dir, 'listing.txt'), listing);
    writeFileSync(join(dir, 'tasklist'), `#!/bin/sh\ncat ${JSON.stringify(join(dir, 'listing.txt'))}\n`);
    writeFileSync(join(dir, 'powershell'), `#!/bin/sh\nnode -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' ${JSON.stringify(record)} "$@"\n`);
    chmodSync(join(dir, 'tasklist'), 0o755);
    chmodSync(join(dir, 'powershell'), 0o755);
    const child = `Object.defineProperty(process, 'platform', { value: 'win32' });
const { heavyBatch } = await import(${JSON.stringify(new URL('scripts/heavy-batch.mjs', ROOT).href)});
const { writeFileSync } = await import('node:fs');
const lockState = (text) => writeFileSync(${JSON.stringify(join(dir, 'listing.txt'))}, text);
let cool;
try { cool = heavyBatch('row'); console.log('STARTED'); } catch (error) { console.log('REFUSED ' + error.message); }
await new Promise((r) => setTimeout(r, 300));
${steps}`;
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, VERA_HEAVY_LOCK: join(dir, 'heavy.lock') };
    delete env.CI;
    delete env.VERA_HEAVY_BATCH;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8', env, timeout: 30000 });
    for (let i = 0; i < 50 && !existsSync(record) && run.stdout.includes('STARTED'); i++) spawnSync('sleep', ['0.1']);
    return { out: run.stdout.trim(), err: run.stderr, status: run.status, awake: existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('CONTROL: unlocked, the batch starts and the awake helper is launched with this batch\'s wait', { skip: process.platform === 'win32' }, () => {
  const { out, err, awake } = runAsWindows(UNLOCKED);
  assert.equal(out, 'STARTED', err);
  assert.ok(Array.isArray(awake), 'powershell was started');
  assert.match(awake.at(-1), /SetThreadExecutionState\(0x80000003\)/);
  assert.match(awake.at(-1), /Wait-Process -Id \d+ /);
});

test('a locked session is refused before anything starts; an unreadable lock state is refused too', { skip: process.platform === 'win32' }, () => {
  const locked = runAsWindows(LOCKED);
  assert.match(locked.out, /^REFUSED row: the session is locked \(LogonUI\.exe is running\)/, locked.err);
  assert.equal(locked.awake, null, 'nothing was launched for a refused batch');
  const unreadable = runAsWindows('ERROR: Access denied');
  assert.match(unreadable.out, /^REFUSED row: the session's lock state could not be read/, unreadable.err);
  assert.equal(unreadable.awake, null);
});

/** Two steps and the batch's end, with the lock state set between them; the step function names the step it starts. */
const STEPS = (between, after) => `
cool('first');
lockState(${JSON.stringify(between)});
try { cool('second'); console.log('SECOND RAN'); } catch (error) { console.log('STEP REFUSED ' + error.message); }
lockState(${JSON.stringify(after)});`;

test('a step that ends locked fails at the next step, and the last step at the exit; CONTROL: unlocked throughout passes', { skip: process.platform === 'win32' }, () => {
  const clean = runAsWindows(UNLOCKED, STEPS(UNLOCKED, UNLOCKED));
  assert.deepEqual([clean.out, clean.status], ['STARTED\nSECOND RAN', 0], clean.err);

  const midway = runAsWindows(UNLOCKED, STEPS(LOCKED, UNLOCKED));
  assert.equal(midway.out, 'STARTED\nSTEP REFUSED row: first ended with the session locked — its readings are not trusted; re-run it', midway.err);

  const atEnd = runAsWindows(UNLOCKED, STEPS(UNLOCKED, LOCKED));
  assert.equal(atEnd.out, 'STARTED\nSECOND RAN');
  assert.equal(atEnd.status, 1, 'the last step ending locked fails the batch');
  assert.match(atEnd.err, /^row: second ended with the session locked — its readings are not trusted; re-run it$/m);

  const unreadable = runAsWindows(UNLOCKED, STEPS('ERROR: Access denied', UNLOCKED));
  assert.match(unreadable.out, /STEP REFUSED row: first ended with the session's lock state unreadable \(tasklist\)/, unreadable.err);
});
