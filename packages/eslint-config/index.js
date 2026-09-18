/**
 * Shareable ESLint flat config for VeraJS.
 *
 * Deliberately narrow. It does not opine on your JavaScript style, bring a parser, or pull in a
 * plugin — every rule is an ESLint built-in driven by a selector, so this package has no
 * dependencies. It covers the two VeraJS mistakes that produce **no error at all** — the code runs,
 * the wrong thing happens, and there is nothing to search for — plus one convention a published
 * package wants (`type` over `interface`) that no other rule expresses without overreaching.
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
 * Stricter than strictly necessary, on purpose — and one case is now genuinely covered without it:
 * a property a TEMPLATE BINDING delivered is recorded by `@verajs/renderer` and re-applied by
 * `init()` after upgrade, in both field spellings, so a component that calls `init()` keeps its
 * bound props whatever you write. What no repair reaches is an IMPERATIVE assignment
 * (`el.item = data`) before upgrade — the renderer never saw it, so nothing recorded it. Nothing in
 * the syntax says which kind a field will receive, and the cost of being wrong is silent data loss
 * against the cost of one keyword, so the rule still flags every one.
 */
/**
 * **`type` unless the interface genuinely extends — CODE-PRINCIPLES §1.3, made mechanical.**
 *
 * The convention was written down and enforced by nothing, so 64 non-extending interfaces
 * accumulated across six packages before anything went looking. Prose in a document is enforced
 * only by whoever happens to read it.
 *
 * The 64th is why this is a SELECTOR and not a script. A regex sweep found 63 by testing for
 * `\bextends\b` between the interface name and the brace — which `MatchResult<P extends ParamData>`
 * satisfies with a type-parameter CONSTRAINT, so the one interface whose heritage clause was hardest
 * to eyeball by hand was the one the sweep silently cleared. `:has(TSInterfaceHeritage)` asks the
 * parser for the heritage clause itself and cannot confuse the two.
 *
 * It is not a cosmetic difference in either direction. A type alias carries an implicit index
 * signature an interface does not, so the two disagree about assignability to
 * `Record<string, unknown>`; and an interface is open to DECLARATION MERGING, which is the half
 * that matters for a published package — a consumer can silently reshape a type you export.
 *
 * `@typescript-eslint/consistent-type-definitions` is deliberately not used for this: its `type`
 * option forbids every interface, including the genuine extension the principles name as the model
 * (`interface ComponentHook extends Omit<Hook, …>`). A rule that contradicts the convention it
 * enforces teaches people to switch it off. This says exactly what the principle says.
 *
 * Where merging is the POINT, disable it with the reason — `JSX.IntrinsicElements` is the case in
 * this repo: a TSX consumer augments it with their own custom elements, and a type alias cannot be
 * augmented at all.
 */
export const noNonExtendingInterface = {
  selector: 'TSInterfaceDeclaration:not(:has(TSInterfaceHeritage))',
  message:
    'Use a `type` unless the interface genuinely extends another. An interface is open to ' +
    'declaration merging, which a published type is not meant to be, and a type alias carries the ' +
    'implicit index signature an interface lacks. Where merging IS the point, disable this and say why.',
};

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
 * Take `wire` from the package that owns the extension point — `@verajs/core` for `render`,
 * `proxy-handler`, `set-handler`, `error`, `init` and `collection`. Importing `@verajs/inserts` for
 * anything else, such as the registry itself, is untouched by this rule.
 *
 * The restricted name is `wire`. It was `insert` until the 0.2.0 rename, and a rule naming an
 * import that no longer exists catches nothing — the mistake it was written for went unguarded.
 */
export const noInsertFromInsertsPackage = {
  name: '@verajs/inserts',
  importNames: ['wire'],
  message:
    'Import `wire` from the package that owns the extension point (`@verajs/core`), not from ' +
    '`@verajs/inserts`. A production bundle inlines its own registry, so registering through a ' +
    'separate copy writes to a map that package never reads — in development it works, in ' +
    'production it silently does nothing.',
};

/** The flat-config array. Spread it into your own config. */
export default [
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', noCustomElementClassFields, noNonExtendingInterface],
      'no-restricted-imports': ['error', { paths: [noInsertFromInsertsPackage] }],
    },
  },
];
