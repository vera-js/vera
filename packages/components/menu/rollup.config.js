import { defaultRollupConfig } from '../../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/** The framework and the hooks stay external: its registry and stores must be the app's own (two copies would split them). */
const external = ['@verajs/core', '@vera-hooks/roving-focus', '@vera-hooks/typeahead'];
const mangle = /^_[a-z]/;

export default [
  /** `.` registers (`src/register.ts`); `./element` is the options and setup with no side effect (`src/index.ts`). */
  defaultRollupConfig(pkg.filename, external, mangle, { input: 'src/register.ts', alwaysExternal: external }),
  defaultRollupConfig(`${pkg.filename}-element`, external, mangle, { input: 'src/index.ts', alwaysExternal: external }),
];
