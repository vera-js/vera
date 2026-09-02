---
'@verajs/ssr': minor
---

The `./vera` subpath is removed — import from `@verajs/ssr`

`@verajs/ssr/vera` was a fossil of the multi-strategy era (wcc fork, Astro adapter), when the
suffix said *which* SSR you were getting. The vera-native implementation has been the only one
for some time, and both specifiers pointed at the same module — a package named vera, scoped
vera, sub-pathed vera. The plain specifier is the import now; the subpath is gone from the
`exports` map and `tests/docs-removed-apis.test.mjs` keeps the old spelling out of the docs.

Breaking under the 0.x rule (a resolvable specifier stops resolving), hence minor.
