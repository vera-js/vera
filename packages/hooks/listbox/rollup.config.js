import { defaultRollupConfig } from '../../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/** The framework stays external: its registry and stores must be the app's own (two copies would split them). */
const external = ['@verajs/core', '@vera-hooks/light-dismiss'];
const mangle = /^_[a-z]/;

export default [
  defaultRollupConfig(pkg.filename, external, mangle, { input: 'src/index.ts', alwaysExternal: external }),
];
