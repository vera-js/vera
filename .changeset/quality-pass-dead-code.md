---
'@verajs/core': patch
'@verajs/ssr': patch
'@verajs/jsx': patch
---

A dead-code and consistency sweep from the full-line read — no behaviour changes

Every removal was verified unreachable before it went: core's `runHooks` kept an optional call on a
value already guarded, and `runCallbacks` re-fetched through two map lookups the very set it was
iterating; the ssr serializer's final `raw` ternary sat below the early return that makes it
unreachable, an entity-table entry could never match its own regex branch, and the fragment parser
carried a variable it only ever `void`ed; the JSX transform now initialises `usedSpread` beside its
two siblings instead of relying on undefined-is-falsy.

Also in `@verajs/ssr`: the Set-diff that recovered "the entry `setRenderer` registered" around the
`wire()` call was a leftover from an API that registered a wrapper. `wire` registers the function it
is handed, so the renderer-displacement guard now asks the chain for `serverRenderer` by identity —
same check, two lines and one allocation fewer, and the comments above it stop teaching a removed
API.

Net −16 B gzipped on `@verajs/core`; size claims re-synced.
