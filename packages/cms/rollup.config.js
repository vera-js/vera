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

/**
 * **Who reads each entry's errors decides its words** (code-system phase 5, vera-5a, 2026-10-09). `content` is a
 * VISITOR's page: its words are development's, and a Node consumer (an SSG reading content) gets them through the
 * `node` export condition's build (`MODE=node`). `publish`, `node` and the cli are read by the person who fixes the
 * error — an author in Studio, a build at a terminal — so they keep their words in every build (`words`).
 */
const content = defaultRollupConfig(`${pkg.filename}-content`, [], /^_[a-z]/, { input: 'src/content.ts' });
export default process.env.MODE === 'node'
  ? [content]
  : [
      content,
      defaultRollupConfig(`${pkg.filename}-publish`, [], /^_[a-z]/, { input: 'src/publish.ts', words: true }),
      defaultRollupConfig(`${pkg.filename}-node`, NODE_BUILTINS, /^_[a-z]/, { input: 'src/node.ts', alwaysExternal: NODE_BUILTINS, words: true }),
      defaultRollupConfig(`${pkg.filename}-cli`, NODE_BUILTINS, /^_[a-z]/, { input: 'src/cli.ts', alwaysExternal: NODE_BUILTINS, words: true }),
    ];
