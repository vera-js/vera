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
    rules: {
      /**
       * Custom-element instance fields must be `declare`, never plain fields.
       *
       * At target ES2022 `useDefineForClassFields` is on, so a field declaration compiles to a
       * `[[Define]]` — `item?: Thing` emits `item;`, i.e.
       * `Object.defineProperty(this, 'item', { value: undefined })`. That runs during upgrade, and
       * a custom element is routinely given properties *before* it upgrades: a parent binds
       * `.item=${store}` while the child's module is still loading, or code assigns to an element
       * whose definition has not run. The field then silently overwrites the value. Dropping the
       * initializer does not help — only `declare`, which emits nothing, does.
       *
       * `@verajs/renderer` restores values it bound itself and warns in development, but a
       * property assigned imperatively is unrecoverable: nothing ever saw it. So this stays a
       * build-time error rather than a convention. `static` is excluded — `static styles` is the
       * `@verajs/styles` pattern and is never an instance field.
       *
       * Lit reached the same rule from the other direction; a class field permanently shadows
       * their prototype accessors, and their development build throws
       * (`lit.dev/msg/class-field-shadowing`).
       */
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(ClassDeclaration, ClassExpression)[superClass.name="HTMLElement"]' +
            ' > ClassBody > PropertyDefinition[static!=true][declare!=true]',
          message:
            'Declare custom-element instance fields with `declare` (e.g. `declare item?: Thing`). ' +
            'A plain field compiles to a [[Define]] that runs at upgrade and silently overwrites ' +
            'any value set on the element beforehand.',
        },
      ],
    },
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

  /**
   * Browser suites. `it`/`describe` come from the test runner's framework, the code runs in a real
   * browser, and chai's `expect(x).to.be.true` is an expression statement by design — the rule
   * cannot tell it from a mistake.
   */
  {
    files: ['tests/browser/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.mocha },
    },
    rules: { '@typescript-eslint/no-unused-expressions': 'off' },
  },

  /**
   * Svelte rune modules. `$state` and friends are compiler intrinsics, not imports — they exist
   * only until `svelte/compiler` rewrites them, so eslint has no way to know they are legitimate.
   */
  {
    files: ['**/*.svelte.js'],
    languageOptions: {
      globals: { $state: 'readonly', $derived: 'readonly', $effect: 'readonly', $props: 'readonly' },
    },
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
