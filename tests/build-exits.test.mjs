/**
 * **A build closes its TypeScript watch program for good, so the build exits.** @rollup/plugin-typescript runs a
 * TypeScript watch program in every build and closes it in `buildEnd`. TypeScript 6.0.3's `close()` leaves a pending
 * program update scheduled (microsoft/TypeScript#64450, which 6.0 will not get a fix for), so a file event just before
 * the close (another package's build writing a watched directory, all through a parallel clean build) rebuilt the
 * program after it was closed, with new watchers nothing closed: the build wrote its bundle and never exited (the
 * Windows clean-build hang, 2026-11-20). @rollup/plugin-typescript 12.3.1 cancels the timers the program armed when it
 * closes it, and `package.json` holds the plugin at `^12.3.1` for that.
 *
 * The first row drives a plain TypeScript watch program through the bug's order of events (create, change a watched
 * file, close before the update's 250 ms timer, wait past it): it rebuilds, which shows the order of events reaches the
 * bug here. The second runs a REAL build through `defaultRollupConfig.js` the same way in its own process, which must
 * end by itself, with a control that its file change did schedule an update. A few seconds, nothing written but an
 * identical rewrite of one source file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { packageFiles } from '../scripts/packages.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The programs a plain watch program creates when one of its files changes just before it is closed. */
const programsAfterCloseRace = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'build-exits-'));
  const file = join(dir, 'a.ts');
  writeFileSync(file, 'export const a = 1;\n');
  let created = 0;
  const host = ts.createWatchCompilerHost([file], { noEmit: true, strict: true }, ts.sys, ts.createSemanticDiagnosticsBuilderProgram, () => {}, () => {});
  const after = host.afterProgramCreate;
  host.afterProgramCreate = (program) => {
    created++;
    after?.(program);
  };
  const program = ts.createWatchProgram(host);
  try {
    await sleep(300); // the watchers are live
    writeFileSync(file, 'export const a = 2;\n');
    await sleep(80); // the change event arrives and schedules the update
    program.close();
    await sleep(900); // past the update's timer
    return created;
  } finally {
    program.close(); // a program rebuilt after the first close holds new watchers: close those too
    rmSync(dir, { recursive: true, force: true });
  }
};

test('CONTROL: a plain TypeScript watch program rebuilds when it changed just before it was closed', async () => {
  assert.ok((await programsAfterCloseRace()) >= 2, 'the order of events did not reach the bug, so the next row proves nothing (or TypeScript fixed it: then say so here)');
});

/**
 * **The build process ends by itself**, which is the claim: a program rebuilt after the close holds watchers nothing
 * closes, and the process stays alive (the hang). `tests/fixtures/build-exits/child.mjs` runs one real package build
 * with its entry rewritten mid-build; it is given 20 s, against about 2 s for a build that closes cleanly, and a child
 * still running then is killed and read as the hang. (Spying on the program count inside this process cannot work:
 * `ts.createWatchProgram` is a getter-only export.)
 */
test('a build through defaultRollupConfig exits by itself, though its file changed mid-build', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/build-exits/child.mjs', import.meta.url)), ROOT], {
    cwd: join(ROOT, 'packages', 'inserts'),
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(child.error?.code, undefined, `the build did not exit within 20 s (the hang): ${child.error?.code}`);
  assert.equal(child.status, 0, `the build failed: ${child.stderr.slice(-2000)}`);
  const report = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.ok(report.scheduled >= 1, 'CONTROL: the mid-build change scheduled a program update, so the close met one pending');
  /** An options diagnostic (TS5096 was every build's) makes TypeScript skip every type error, so none may appear. */
  assert.deepEqual(report.options, [], 'no options diagnostic hides the type errors');
});

test('package.json holds @rollup/plugin-typescript at the release that cancels the pending update', () => {
  const { devDependencies } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(devDependencies['@rollup/plugin-typescript'], '^12.3.1', 'below 12.3.1 a fresh install can resolve the hang back');
  const { version } = JSON.parse(readFileSync(join(ROOT, 'node_modules/@rollup/plugin-typescript/package.json'), 'utf8'));
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(major > 12 || (major === 12 && (minor > 3 || (minor === 3 && patch >= 1))), `installed ${version}, which is below 12.3.1`);
});

/**
 * **Every package builds through defaultRollupConfig**, which carries the plugin options every build needs
 * (`allowImportingTsExtensions: false`, without which no build reports a type error). A package config that made its
 * own @rollup/plugin-typescript would build without them, so each one must import the shared config and none may import
 * the plugin itself.
 */
test('every package builds through defaultRollupConfig, and none creates the TypeScript plugin itself', () => {
  const configs = packageFiles('rollup.config.{js,mjs}');
  assert.ok(configs.length >= 18, `CONTROL: ${configs.length} package configs read (ssr compiles with tsc and has none)`);
  const shared = /from\s+['"](?:\.\.\/)+defaultRollupConfig\.js['"]/;
  const own = /['"]@rollup\/plugin-typescript['"]/;
  const bad = configs.filter((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return !shared.test(text) || own.test(text);
  });
  assert.deepEqual(bad, [], 'build through defaultRollupConfig');
  assert.ok(own.test("import typescript from '@rollup/plugin-typescript';") && !shared.test("import x from './other.js';"), 'CONTROL: both patterns fire (planted)');
});
