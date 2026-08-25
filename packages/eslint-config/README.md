# @verajs/eslint-config

Shareable ESLint flat config for VeraJS.

It covers two mistakes that produce **no error at all** — the code runs, the wrong thing happens,
and there is nothing to search for. Everything else is left alone: no style opinions, no parser, no
plugin, no dependencies.

```sh
npm i -D @verajs/eslint-config
```

```js
// eslint.config.js
import vera from '@verajs/eslint-config';

export default [
  ...vera,
];
```

TypeScript files need a parser, which is yours to choose — `@typescript-eslint/parser` is the usual
one. Without it ESLint cannot read a `.ts` file at all, let alone tell `declare item` from `item`.

```js
import tsParser from '@typescript-eslint/parser';
import vera from '@verajs/eslint-config';

export default [
  { files: ['**/*.ts'], languageOptions: { parser: tsParser } },
  ...vera,
];
```

## The rules

### No plain class fields on custom elements

```ts
class UserCard extends HTMLElement {
  user?: { name: string };          // ✗ error
  declare user?: { name: string };  // ✓
}
```

A custom element is routinely given properties **before it upgrades** — a parent binds
`.user=${store}` while the child's module is still loading, or code assigns to an element whose
`customElements.define` has not run yet. The property lands as an own property on the un-upgraded
instance. Then the definition arrives, `define` upgrades the element *synchronously*, the class's
field initializers run, and the value is overwritten. Nothing throws. The component renders empty
and it looks like broken reactivity.

In TypeScript this is invisible, which is what earns it a rule. At target ES2022
`useDefineForClassFields` is on, so a field *declaration* is a runtime instruction: `user?: Thing`
compiles to `user;`, which is `Object.defineProperty(this, 'user', { value: undefined })`. Dropping
the initializer does not help. Only `declare`, which emits nothing, does.

`@verajs/tsconfig` turns `useDefineForClassFields` off, which fixes that spelling project-wide
without `declare`. A field written with an explicit default (`count = 0`) still assigns during
upgrade either way — but that one is at least visible in your source.

In plain JavaScript the field is visible too. Omit it, and assign in `connectedCallback` if you
need a default.

`static` is excluded — `static styles` is the `@verajs/styles` pattern and is never an instance
field. Customized built-ins (`HTMLDivElement` and friends) are covered as well as `HTMLElement`.

This is stricter than strictly necessary, on purpose. A field that nothing sets from outside is
harmless, but nothing can tell the two apart from the syntax, and the cost of being wrong is silent
data loss against the cost of one keyword.

### No `insert` from `@verajs/inserts`

```js
import { wire } from '@verajs/inserts';  // ✗ error
import { wire } from '@verajs/core';     // ✓
```

Each package's `dist/*.min.js` inlines its dependencies so the bundle stands alone. A production
build therefore gives `@verajs/core` its own copy of the insert registry, and registering through a
separately imported `@verajs/inserts` writes to a map core never reads. Nothing throws — the
callback simply lands somewhere else, so it works in development and silently does nothing in
production. `@verajs/styles` was written this way first and passed every development test.

Take `insert` from the package that owns the extension point: `@verajs/core` for `render`,
`proxy-handler`, `set-handler`, `error` and `init`. Importing `@verajs/inserts` for anything else —
the registry itself — is untouched by this rule.

## Composing

Both rule bodies are exported if you would rather assemble them yourself:

```js
import { noCustomElementClassFields, noInsertFromInsertsPackage } from '@verajs/eslint-config';
```

## License

MIT
