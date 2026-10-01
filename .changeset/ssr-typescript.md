---
'@verajs/ssr': patch
---

`@verajs/ssr` is TypeScript, with precise published types

The package is now written in TypeScript and compiled by `tsc` to `dist/`, under the same strict checks as every
other Vera package. Its runtime is unchanged: every compiled file, minified, is byte-identical to the JavaScript it
replaces. What ships is `dist/` (JavaScript, declarations and source maps) where it used to be `src/`. Imports of
`@verajs/ssr` are unaffected.

The published types are more precise. Three of them are narrower, each matching what the runtime already accepted:

- `renderToStringAsync`'s options are the same `SsrRenderOptions` as `renderToString`'s, not `object`.
- `registry` is `Map<string, CustomElementConstructor>` (tag names to classes), not `Map<any, any>`.
- `serializeTemplate` takes a template (`SsrTemplate`) and returns `string`, not `any`.

`SsrRenderOptions` and `SsrRenderResult` are exported for TypeScript users.
