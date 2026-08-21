import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Scope first. Without `ignores`, this linted `dist/` (generated bundles, mangled and minified)
 * and `internal/` (a separate private repository cloned into this tree and gitignored here) —
 * together ~2 200 of ~2 230 reported problems, which made the real ones unfindable.
 *
 * Globals are per area rather than global-browser-everywhere: the build scripts, benchmarks, tests
 * and `@verajs/ssr` are Node, and telling eslint that `process` is a browser global is how
 * `defaultRollupConfig.js` ended up carrying an eslint-disable comment for a legitimate use.
 */
export default [
  {
    ignores: [
      '**/dist/**',
      // A separate repo (vera-js/internal), gitignored here. Not ours to lint.
      'internal/**',
      '**/*.min.js',
      'bench/.size-*/**',
    ],
  },
  { files: ['**/*.{js,mjs,cjs,ts}'] },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      /** `_`-prefixed means deliberately unused here, matching the `_internal` mangling convention. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      /**
       * `packages/jsx/src/parser.js` carries a zero-width space inside `*\u200b/` so a doc comment
       * can show `{/* … *\u200b/}` without terminating itself. It is load-bearing — do not "tidy"
       * it away.
       */
      'no-irregular-whitespace': ['error', { skipComments: true }],
      /** `try { unlink(tmp) } catch {}` in test teardown is the intent, not an oversight. */
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  /** Library and example sources run in a browser. */
  {
    files: ['packages/*/src/**/*.{js,ts}', 'examples/**/*.{js,ts}'],
    languageOptions: { globals: { ...globals.browser, __DEV__: 'readonly' } },
  },

  /**
   * The test harnesses are deliberately dependency-free and every one of them counts results with
   * `cond ? pass++ : (fail++, console.log('FAIL:', name))`. Both halves do work, so the rule is
   * simply wrong here — and `allowTernary` does not cover it, because what it objects to is the
   * comma operator in the else branch, not the ternary. Off for tests rather than rewriting
   * thirteen working harnesses to satisfy it.
   */
  {
    files: ['tests/**/*.mjs'],
    rules: { '@typescript-eslint/no-unused-expressions': 'off' },
  },

  /** Build tooling, benchmarks, tests and the example servers run in Node. */
  {
    files: [
      '*.js',
      '*.mjs',
      'scripts/**/*.{js,mjs}',
      'bench/**/*.{js,mjs}',
      'tests/**/*.{js,mjs}',
      'packages/*/rollup.config.js',
      'packages/ssr/**/*.{js,mjs}',
      'examples/**/serve.js',
      'examples/**/server*.{js,mjs}',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
