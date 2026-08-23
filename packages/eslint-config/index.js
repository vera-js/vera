/**
 * Shareable ESLint flat config for VeraJS.
 *
 * Deliberately narrow. It does not opine on your JavaScript style, bring a parser, or pull in a
 * plugin — both rules are ESLint built-ins driven by a selector, so this package has no
 * dependencies. It covers the two VeraJS mistakes that produce **no error at all**: the code runs,
 * the wrong thing happens, and there is nothing to search for.
 *
 *   import vera from '@verajs/eslint-config';
 *   export default [...vera];
 *
 * TypeScript files need a parser, which is yours to configure — `@typescript-eslint/parser` is the
 * usual choice. Without one ESLint cannot read a `.ts` file at all, let alone tell `declare item`
 * from `item`.
 */

/**
 * A class field on a custom element destroys values set before the element upgrades.
 *
 * A custom element is routinely given properties while it is still un-upgraded: a parent binds
 * `.item=${store}` before the child's module has loaded, or code assigns to an element whose
 * `customElements.define` has not run. The property lands as an own property on the instance. Then
 * the definition arrives, `define` upgrades the element **synchronously**, and the class's field
 * initializers execute — overwriting what was there.
 *
 * In TypeScript this is invisible, which is what makes it worth a rule. At target ES2022
 * `useDefineForClassFields` is on, so a field *declaration* is a runtime instruction: `item?: Thing`
 * emits `item;`, i.e. `Object.defineProperty(this, 'item', { value: undefined })`. Dropping the
 * initializer does not help. Only `declare`, which emits nothing, does. (Setting
 * `useDefineForClassFields: false` — see `@verajs/tsconfig` — fixes this spelling project-wide.)
 *
 * In JavaScript the same field is at least visible in the source; the fix there is to not declare
 * it, and assign in `connectedCallback` if you need a default.
 *
 * `static` is excluded: `static styles` is the `@verajs/styles` pattern and is never an instance
 * field. The regex covers customized built-ins (`HTMLDivElement` and friends) as well as
 * `HTMLElement`.
 *
 * Stricter than strictly necessary, on purpose. A field nothing sets from outside is harmless, but
 * nothing can tell the two apart from the syntax — and the cost of being wrong is silent data loss
 * against the cost of one keyword.
 */
export const noCustomElementClassFields = {
  selector:
    ':matches(ClassDeclaration, ClassExpression)[superClass.name=/^HTML[A-Za-z]*Element$/]' +
    ' > ClassBody > PropertyDefinition[static!=true][declare!=true]',
  message:
    'Do not use a plain class field on a custom element — it runs during upgrade and silently ' +
    'overwrites any property set on the element beforehand. In TypeScript write ' +
    '`declare item?: Thing`, which emits nothing. In JavaScript omit the field and assign in ' +
    '`connectedCallback`.',
};

/**
 * Registering an insert through `@verajs/inserts` works in development and silently does nothing in
 * production.
 *
 * Each package's `dist/*.min.js` inlines its dependencies so the bundle stands alone, so a
 * production build gives core its own copy of the insert registry. Registering through a separately
 * imported `@verajs/inserts` writes to a map core never reads. Nothing throws — the callback simply
 * lands somewhere else. `@verajs/styles` was written this way first and passed every development
 * test.
 *
 * Take `insert` from the package that owns the extension point — `@verajs/core` for `render`,
 * `proxy-handler`, `set-handler`, `error` and `init`. Importing `@verajs/inserts` for anything else,
 * such as the registry itself for `connectInserts`, is untouched by this rule.
 */
export const noInsertFromInsertsPackage = {
  name: '@verajs/inserts',
  importNames: ['insert'],
  message:
    'Import `insert` from the package that owns the extension point (`@verajs/core`), not from ' +
    '`@verajs/inserts`. A production bundle inlines its own registry, so registering through a ' +
    'separate copy writes to a map that package never reads — in development it works, in ' +
    'production it silently does nothing.',
};

/** The flat-config array. Spread it into your own config. */
export default [
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', noCustomElementClassFields],
      'no-restricted-imports': ['error', { paths: [noInsertFromInsertsPackage] }],
    },
  },
];
