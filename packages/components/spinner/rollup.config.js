import { defaultRollupConfig } from '../../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };
import { PREUPGRADE } from './src/spinner/sheet.ts';

/**
 * The framework and the hook stay external: core's registry and stores must be the app's own (two copies would split
 * them), and `announce`, a declared dependency, is imported, never inlined, as field keeps it, so an app that announces
 * itself shares one copy and one settle window with the spinner. The importmap resolves them on a CDN page.
 */
const external = ['@verajs/core', '@vera-hooks/announce'];
const mangle = /^_[a-z]/;

/**
 * `dist/preupgrade.css` (the `./preupgrade.css` export), written by the production build from the same constant the
 * element's rule is built from (`src/spinner/sheet.ts`, read here through Node's type stripping), so it is never a
 * committed twin that could drift.
 */
const preupgrade = {
  name: 'vera-spinner-preupgrade',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'preupgrade.css', source: PREUPGRADE });
  },
};

const element = defaultRollupConfig(pkg.filename, external, mangle, { input: 'src/register.ts', alwaysExternal: external });
if (process.env.MODE === 'prod') element.plugins.push(preupgrade);

export default [
  /** `.` registers (`src/register.ts`); `./element` is the options and setup with no side effect (`src/index.ts`). */
  element,
  defaultRollupConfig(`${pkg.filename}-element`, external, mangle, { input: 'src/index.ts', alwaysExternal: external }),
];
