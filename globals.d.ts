/**
 * Build-time constant, folded to a literal by `defineDev()` in `defaultRollupConfig.js`:
 * `true` in `dist/development/`, `false` in `dist/*.min.js` where terser then deletes the branch.
 *
 * Everything behind it must be strictly optional — the production build has to behave identically
 * with every `if (__DEV__)` block removed. Declared here rather than per package because each
 * package's tsconfig overrides `include`, but inherits `files` from the root.
 */
declare const __DEV__: boolean;
