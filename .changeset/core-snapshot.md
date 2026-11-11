---
'@verajs/core': patch
---

`snapshot(value)`: a deep plain copy of state, for cloning, sending or saving it

A record written into a store is stored as given (its getters never run on the write), so the raw data passed to
`createStore` can hold stores, which can't be cloned (`structuredClone`, `postMessage` and IndexedDB throw on one).
`snapshot(state)` returns a plain copy instead: every store replaced by its data at every depth, `Map`s and `Set`s copied
with their entries, cycles kept, and anything else (a class instance, a `Date`) kept as given. An own `__proto__` key (as
`JSON.parse` makes) is copied as a key. It costs a walk of what it copies, only when called.
