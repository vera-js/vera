import { defaultRollupConfig } from '../../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * The framework stays external: its registry and stores must be the app's own (two copies would split them). The
 * announce hook too, so an app that announces itself shares one copy (and one live region) with the input.
 */
const external = ['@verajs/core', '@vera-hooks/announce'];
const mangle = /^_[a-z]/;

export default [
  /** `.` registers (`src/register.ts`); `./element` is the options and setup with no side effect (`src/index.ts`). */
  defaultRollupConfig(pkg.filename, external, mangle, { input: 'src/register.ts', alwaysExternal: external }),
  defaultRollupConfig(`${pkg.filename}-element`, external, mangle, { input: 'src/index.ts', alwaysExternal: external }),
  /** `./stepper`: the number stepper, wired by the page (`wire([stepper])`); it imports nothing from the element. */
  defaultRollupConfig(`${pkg.filename}-stepper`, external, mangle, { input: 'src/stepper.ts', alwaysExternal: external }),
];
