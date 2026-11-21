---
'@verajs/core': minor
'@verajs/lite': patch
---

`isServer` is now a function, `isServer()`, read when it is called. As a constant computed when core loaded, it answered
`false` for the whole process whenever core was imported before `@verajs/ssr`, so per-user state guarded by it was
rendered into server markup. **Code written as `if (!isServer) …` must become `if (!isServer()) …`**: a function is
always truthy, so the old spelling no longer throws, it silently takes the server branch everywhere, in the browser
too. `@verajs/lite` gains the same `isServer()`, so a component guarding per-user state runs unchanged on either tier.
