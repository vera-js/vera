# @verajs/tsconfig

TypeScript base config for VeraJS components.

```sh
npm i -D @verajs/tsconfig
```

```json
{
  "extends": "@verajs/tsconfig",
  "include": ["src"]
}
```

## Why this exists

One setting, and it is the reason this package is worth installing:

```json
"useDefineForClassFields": false
```

At target ES2022 that option defaults to **on**, and it makes a field *declaration* into a runtime
instruction:

```ts
class UserCard extends HTMLElement {
  user?: { name: string };
}
```

```js
// with useDefineForClassFields: true — the default
class UserCard extends HTMLElement {
  user;                       // Object.defineProperty(this, 'user', { value: undefined })
}

// with useDefineForClassFields: false — what this config sets
class UserCard extends HTMLElement {
}                             // nothing emitted
```

That matters because a custom element is routinely given properties **before it upgrades** — a
parent binds `.user=${store}` while the child's module is still loading, or code assigns to an
element whose `customElements.define` has not run. The property lands on the un-upgraded instance;
then `define` upgrades it *synchronously*, the field initializer runs, and the value is silently
overwritten. Nothing throws. The component renders empty and it reads as broken reactivity.

Turning the option off means the declaration emits nothing, so there is nothing to overwrite — and
you do not have to remember `declare` on every such field.

## What it does not fix

A field written with an explicit default still assigns during construction either way:

```js
// useDefineForClassFields: false
class UserCard extends HTMLElement {
  constructor() {
    super(...arguments);
    this.count = 0;           // still overwrites a value set before upgrade
  }
}
```

That spelling is at least visible in your source, unlike the declaration above. `@verajs/eslint-config`
flags both.

## The trade-off, stated plainly

`useDefineForClassFields: false` is project-wide, not component-only. It opts **all** your classes
out of standard ES2022 class-field semantics and back to the assignment semantics TypeScript used
before. That is well-trodden ground — it was the only behaviour for years, and Lit recommends the
same setting — but it is a real divergence from what the language does, and it applies to code that
has nothing to do with web components.

If you would rather stay on standard semantics, do not extend this config; write `declare` on
custom-element fields instead and let `@verajs/eslint-config` enforce it.

## Everything else in here

Ordinary defaults for a modern component package, all overridable:

| | |
| --- | --- |
| `target` / `lib` | `ES2022`, with `DOM` and `DOM.Iterable` |
| `module` / `moduleResolution` | `ESNext` / `Bundler` |
| `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | on |
| `isolatedModules`, `verbatimModuleSyntax` | on — required by most bundlers |
| `skipLibCheck`, `forceConsistentCasingInFileNames`, `sourceMap` | on |

It sets no `outDir`, `rootDir`, `include` or `paths`. Those are yours.

## License

MIT
