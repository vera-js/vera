import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Two entries. The plugin entry is the compiler and the Vite plugin — Node-side tooling, and also
 * what the standalone loader imports LAZILY in a browser, only when something must be compiled.
 * `standalone` is the browser half: the module loader for `<script type="text/vera-jsx">` blocks
 * and the files they import. It keys its compiled cache by `__VERSION__` (see `defaultRollupConfig`),
 * so output cached by one version of the compiler is never served under another. A third build, `MODE=node`, is the
 * compiler again for Node and Vite: minified, with its words (see `defaultRollupConfig`).
 */
const compiler = defaultRollupConfig(pkg.filename, [], /^_[a-z]/);
/** `MODE=node` builds the compiler alone — the build Node and Vite load (`node` export condition): minified, words kept. */
export default process.env.MODE === 'node'
  ? [compiler]
  : [compiler, defaultRollupConfig(`${pkg.filename}-standalone`, [], /^_[a-z]/, { input: 'src/standalone.ts' })];
