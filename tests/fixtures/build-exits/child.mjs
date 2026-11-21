/**
 * One real package build through `defaultRollupConfig.js`, run as its own process by `tests/build-exits.test.mjs`, in
 * the package's directory (the config reads the version from its package.json). A plugin rewrites the entry with its own
 * bytes while the build runs and waits for the change event, so a TypeScript program update is pending when the plugin
 * closes its watch program. A spy on `ts.sys.setTimeout` counts the updates scheduled. It prints one JSON line and then
 * returns without `process.exit`: the parent's claim is that the process ends by itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { comparable } from '../../../scripts/fs-path.mjs';

const [root] = process.argv.slice(2);
/** The delay TypeScript's watch program schedules a program update with (`scheduleProgramUpdate`). */
const UPDATE_DELAY = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let scheduled = 0;
const schedule = ts.sys.setTimeout;
ts.sys.setTimeout = (callback, ms, ...args) => {
  if (ms === UPDATE_DELAY) scheduled++;
  return schedule(callback, ms, ...args);
};

const { rollup } = await import('rollup');
const { defaultRollupConfig } = await import(new URL('../../../defaultRollupConfig.js', import.meta.url).href);
const entry = join(root, 'packages', 'inserts', 'src', 'index.ts');
const config = defaultRollupConfig('build-exits', []);
const warnings = [];
const touch = {
  name: 'touch-mid-build',
  async transform(_code, id) {
    if (comparable(id) !== comparable(entry)) return null;
    writeFileSync(entry, readFileSync(entry));
    await sleep(150); // the change event arrives and schedules the update before buildEnd closes the program
    return null;
  },
};
const bundle = await rollup({ ...config, plugins: [...config.plugins, touch], onwarn: (warning) => warnings.push(String(warning.message)) });
await bundle.close();
console.log(JSON.stringify({ scheduled, options: warnings.filter((w) => /TS5\d{3}/.test(w)) }));
