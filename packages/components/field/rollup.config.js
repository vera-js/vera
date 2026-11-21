import { defaultRollupConfig } from '../../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * The framework and the two hooks stay external: core's registry and stores must be the app's own (two copies would
 * split them), and a hook the field declares as a dependency is imported, never inlined, as select keeps listbox, so
 * an app that uses `labeled` or `announce` itself shares one copy with the field. The importmap resolves them on a
 * CDN page.
 */
const external = ['@verajs/core', '@vera-hooks/announce', '@vera-hooks/labeled'];
const mangle = /^_[a-z]/;

export default [
  /** `.` registers (`src/register.ts`); `./element` is the options and setup with no side effect (`src/index.ts`). */
  defaultRollupConfig(pkg.filename, external, mangle, { input: 'src/register.ts', alwaysExternal: external }),
  defaultRollupConfig(`${pkg.filename}-element`, external, mangle, { input: 'src/index.ts', alwaysExternal: external }),
];
