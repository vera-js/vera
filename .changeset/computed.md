---
'@verajs/core': patch
---

Return the hook callback from `createHook`.

It already built the wrapped callback and discarded it. Handing it back is the only way for a caller
to run the hook itself, which is the only way to record what it reads: tracking is live only while
`hooksQueue` holds that hook's entry, and that is only true inside the wrapper. A component never
needs it — `render()` drives the first pass — but anything owning its own reactive value does, and
reaching into `element._hooks` for it is not an API.

Two bytes, and it is the difference between a module being able to build on core and having to reach
inside it. `@verajs/computed` is the first to use it.
