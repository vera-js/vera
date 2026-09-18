# @verajs/eslint-config

Shareable ESLint flat config for VeraJS.

It covers two mistakes that produce **no error at all** — the code runs, the wrong thing happens,
and there is nothing to search for — plus one convention a published package wants and nothing else
enforces. Everything else is left alone: no style opinions, no parser, no plugin, no dependencies.

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

This is stricter than strictly necessary, on purpose — and one case is now genuinely covered
without it. A property a **template binding** delivered (`.user=${…}`, `props({ user })`, a spread
bag) is recorded by `@verajs/renderer` and re-applied by `init()` after upgrade, in both field
spellings, so a component that calls `init()` keeps its bound props whatever you write. What no
repair can reach is a property assigned **imperatively** (`el.user = data`) before upgrade: the
renderer never saw it, so nothing recorded it, and the field still wipes it. Nothing in the syntax
says which kind a field will receive, and the cost of being wrong is silent data loss against the
cost of one keyword — so the rule still flags every one.

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

Take `wire` from the package that owns the extension point: `@verajs/core` for `render`,
`proxy-handler`, `set-handler`, `error` and `init`. Importing `@verajs/inserts` for anything else —
the registry itself — is untouched by this rule.

### `type` unless the interface genuinely extends

```ts
export interface Options { mode: string }           // ✗ error
export type Options = { mode: string };             // ✓
export interface ComponentHook extends Hook { … }   // ✓ — it extends
```

An **interface is open to declaration merging**, and for a type you publish that is a door you did
not mean to leave open: a consumer writes `declare module` with the same interface name and silently
adds members to your type, in their build, with no error on either side. A type alias simply cannot
be merged. The two also disagree about assignability — a type alias carries an implicit index
signature, so it satisfies `Record<string, unknown>` where the identical interface does not, which
is the version of this that shows up as a confusing error rather than as silence.

Where merging **is** the point, disable it and say so. `JSX.IntrinsicElements` is the canonical
case: a TSX app adds its own custom elements by merging into it, and a type alias would remove the
only way to do that.

`@typescript-eslint/consistent-type-definitions` is deliberately not what this uses. Its `type`
option forbids *every* interface, including the genuine extension — and a rule that contradicts the
convention it enforces just teaches people to switch it off.

## Composing

The rule bodies are exported if you would rather assemble them yourself:

```js
import {
  noCustomElementClassFields,
  noInsertFromInsertsPackage,
  noNonExtendingInterface,
} from '@verajs/eslint-config';
```

## License

MIT
