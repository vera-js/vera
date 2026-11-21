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
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { oneShotTypescript } from '../defaultRollupConfig.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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

/**
 * The WIRING: the rows above prove `oneShotTypescript` is right; this one proves the config hands it to the plugin. An
 * in-memory build of a tiny package through the real config (nothing written) must create its watch program through
 * the one-shot TypeScript, seen by a spy defined on that object alone. Dropping the option from the plugin call makes
 * the plugin use its own TypeScript and turns this red.
 */
test('defaultRollupConfig hands @rollup/plugin-typescript the one-shot TypeScript', async () => {
  const { rollup } = await import('rollup');
  const { defaultRollupConfig } = await import('../defaultRollupConfig.js');
  /** A package build runs in its package (the config reads the version from its package.json), so this one does too. */
  const before = process.cwd();
  let calls = 0;
  const warnings = [];
  const real = oneShotTypescript.createWatchProgram;
  Object.defineProperty(oneShotTypescript, 'createWatchProgram', { configurable: true, value: (host) => (calls++, real(host)) });
  try {
    process.chdir(fileURLToPath(new URL('../packages/inserts/', import.meta.url)));
    const bundle = await rollup({ ...defaultRollupConfig('one-shot-wiring', []), onwarn: (warning) => warnings.push(String(warning.message)) });
    await bundle.close();
  } finally {
    process.chdir(before);
    delete oneShotTypescript.createWatchProgram;
  }
  assert.equal(calls, 1, 'the plugin built its program through the one-shot TypeScript');
  /** An options diagnostic (TS5096 was every build's) makes TypeScript skip every type error, so none may appear. */
  assert.deepEqual(warnings.filter((w) => /TS5\d{3}/.test(w)), [], 'no options diagnostic hides the type errors');
  assert.equal(oneShotTypescript.createWatchProgram, ts.createWatchProgram, 'the spy is gone');
});

test('rollup watch mode keeps the real TypeScript, rebuilds included', () => {
  assert.notEqual(oneShotTypescript, ts, 'this run is not in watch mode, so it gets the one-shot copy');
  assert.equal(typeof oneShotTypescript.sys.setTimeout, 'undefined');
  assert.equal(oneShotTypescript.createWatchProgram, ts.createWatchProgram, 'everything else is the real TypeScript');
});

/**
 * **The fix reaches every package because every package builds through defaultRollupConfig.** A package config that
 * made its own @rollup/plugin-typescript would build with the plain TypeScript and could hang again, so each one must
 * import the shared config and none may import the plugin itself.
 */
test('every package builds through defaultRollupConfig, and none creates the TypeScript plugin itself', () => {
  const configs = globSync('packages/**/rollup.config.{js,mjs}', { cwd: ROOT, exclude: (f) => f.includes('node_modules') });
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
