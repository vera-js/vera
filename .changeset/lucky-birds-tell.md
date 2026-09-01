---
'@verajs/core': patch
---

Explain a write the language refused, instead of leaving the engine to talk about proxy traps.

A store is a proxy, so a refused write has to be reported by returning `false`, and the engine turns
that into `TypeError: 'set' on proxy: trap returned falsish for property 'n'` — a message about the
trap, which is internals the reader never wrote. The same assignment to an unproxied frozen object
says `Cannot assign to read only property 'n'`, so putting a store in front of an object made the
diagnosis worse. `createStore(Object.freeze(defaults))` is an ordinary thing to write, and a frozen
constants table nested in state is how it usually turns up.

Development now names the rule that refused — frozen, sealed with a new key, non-extensible,
`writable: false`, or a getter with no setter — for both `set` and `delete`. It reports rather than
repairs, because every one of these is a language invariant and not a framework decision.

`__DEV__`-only: **0 B in production**, verified against the built bundle, and it throws in both builds
either way.
