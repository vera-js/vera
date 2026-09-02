import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Two entries, no root — the subpath split is structural, not aspirational:
 * a deployed site loads `content` (read, render) and must never be handed `publish` (the build
 * pipeline — eventually the renderer, indexer, CSS step and git committer). Today the two share
 * everything; they diverge the moment the runtime DOM builder and the pipeline land, and the
 * boundary existing first is what keeps a visitor's bundle from quietly inheriting a committer.
 */
/** The Node-only entries keep the builtins external in every mode — there is no browser to spare them from. */
const NODE_BUILTINS = ['node:fs', 'node:path', 'node:process'];

export default [
  defaultRollupConfig(`${pkg.filename}-content`, [], /^_[a-z]/, { input: 'src/content.ts' }),
  defaultRollupConfig(`${pkg.filename}-publish`, [], /^_[a-z]/, { input: 'src/publish.ts' }),
  defaultRollupConfig(`${pkg.filename}-node`, NODE_BUILTINS, /^_[a-z]/, { input: 'src/node.ts', alwaysExternal: NODE_BUILTINS }),
  defaultRollupConfig(`${pkg.filename}-cli`, NODE_BUILTINS, /^_[a-z]/, { input: 'src/cli.ts', alwaysExternal: NODE_BUILTINS }),
];
