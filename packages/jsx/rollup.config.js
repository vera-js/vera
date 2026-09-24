import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Two entries. The plugin entry is Node-side tooling (Vite config imports it) — built anyway so
 * the package follows the one delivery rule (dev/prod/types out of dist, exports resolving to
 * files the build writes). `standalone` is the browser half — the Babel-standalone pattern for
 * `<script type="text/vera-jsx">` blocks — and it INLINES the transformer: one file on a CDN,
 * no bare specifiers of its own (the page's import map serves the code it EMITS, not it).
 */
export default [
  defaultRollupConfig(pkg.filename, [], /^_[a-z]/),
  defaultRollupConfig(`${pkg.filename}-standalone`, [], /^_[a-z]/, { input: 'src/standalone.ts' }),
];
