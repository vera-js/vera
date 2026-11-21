/**
 * **A one-shot build's TypeScript never rebuilds after it is closed.** @rollup/plugin-typescript runs a TypeScript watch
 * program in every build and closes it in `buildEnd`. TypeScript 6.0.3's `close()` leaves a pending program update
 * scheduled, so a file event just before the close (another package's build writing a watched directory, all through
 * a parallel clean build) rebuilt the program after it was closed, with new watchers nothing closed: the build wrote
 * its bundle and never exited (the Windows clean-build hang). `defaultRollupConfig.js` hands the plugin
 * `oneShotTypescript`, which cannot schedule an update.
 *
 * This drives a REAL watch program through the bug's order of events: create it, change a watched file, close it
 * before the update's 250 ms timer, then wait past it. Plain TypeScript builds a second program (the planted control:
 * it shows the order of events reaches the bug here); the one-shot one builds exactly one. A few seconds, no build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { oneShotTypescript } from '../defaultRollupConfig.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The programs a watch program creates when one of its files changes just before it is closed. */
const programsAfterCloseRace = async (typescript) => {
  const dir = mkdtempSync(join(tmpdir(), 'one-shot-ts-'));
  const file = join(dir, 'a.ts');
  writeFileSync(file, 'export const a = 1;\n');
  let created = 0;
  const host = typescript.createWatchCompilerHost([file], { noEmit: true, strict: true }, typescript.sys, typescript.createSemanticDiagnosticsBuilderProgram, () => {}, () => {});
  const after = host.afterProgramCreate;
  host.afterProgramCreate = (program) => {
    created++;
    after?.(program);
  };
  const program = typescript.createWatchProgram(host);
  try {
    await sleep(300); // the watchers are live
    writeFileSync(file, 'export const a = 2;\n');
    await sleep(80); // the change event arrives and schedules the update (250 ms)
    program.close();
    await sleep(900); // past the update's timer
    return created;
  } finally {
    program.close(); // a program rebuilt after the first close holds new watchers: close those too
    rmSync(dir, { recursive: true, force: true });
  }
};

test('CONTROL: plain TypeScript rebuilds a watch program that changed just before it was closed', async () => {
  assert.ok((await programsAfterCloseRace(ts)) >= 2, 'the order of events did not reach the bug, so the next row proves nothing');
});

test('the one-shot TypeScript defaultRollupConfig hands the plugin never rebuilds after close', async () => {
  assert.equal(await programsAfterCloseRace(oneShotTypescript), 1);
});

test('rollup watch mode keeps the real TypeScript, rebuilds included', () => {
  assert.notEqual(oneShotTypescript, ts, 'this run is not in watch mode, so it gets the one-shot copy');
  assert.equal(typeof oneShotTypescript.sys.setTimeout, 'undefined');
  assert.equal(oneShotTypescript.createWatchProgram, ts.createWatchProgram, 'everything else is the real TypeScript');
});
