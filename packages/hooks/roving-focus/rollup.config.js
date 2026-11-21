import { defaultRollupConfig } from '../../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/** The framework stays external: its registry and stores must be the app's own (two copies would split them). */
const external = [];
const mangle = /^_[a-z]/;

export default [
  defaultRollupConfig(pkg.filename, external, mangle, { input: 'src/index.ts', alwaysExternal: external }),
  /** The first-party seam (`./internal`): the pure move, for this library's own composites. */
  defaultRollupConfig(`${pkg.filename}-internal`, external, mangle, { input: 'src/internal.ts', alwaysExternal: external }),
];
