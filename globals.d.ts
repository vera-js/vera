/**
 * Build-time constant, folded to a literal by `defineDev()` in `defaultRollupConfig.js`:
 * `true` in `dist/development/`, `false` in `dist/*.min.js` where terser then deletes the branch.
 *
 * Everything behind it must be strictly optional — the production build has to behave identically
 * with every `if (__DEV__)` block removed. Declared here rather than per package because each
 * package's tsconfig overrides `include`, but inherits `files` from the root.
 */
declare const __DEV__: boolean;

/**
 * The building package's own version, folded to a string literal by `defaultRollupConfig.js`.
 * `@verajs/jsx`'s loader keys its compiled cache by it; `@verajs/renderer`'s development build
 * compares it with the slots module's.
 */
declare const __VERSION__: string;
