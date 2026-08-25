---
'@verajs/core': patch
'@verajs/renderer': patch
'@verajs/inserts': patch
---

Audit fixes: falsy guards, write suppression, and a 13% faster read path

Three correctness defects in core, all the same shape — a legal falsy value tested for truth:

- **`css` dropped a zero.** `margin: ${0}px` produced `margin: px` and `z-index: ${0}` produced
  `z-index: `, declarations the parser discards, so a rule silently lost a property. Every zero out
  of a computed layout hit it.
- **Hook priority `0` registered nothing.** Lower runs earlier, so zero is the earliest priority
  there is and the obvious choice for a hook that must run first — and it was the one value that did
  not work. Now the same finite-number rule `wire` uses, which also catches `NaN`.
- **`defineProperty` suppression was process-wide.** Any write in flight suppressed every definition
  anywhere, so a setter that defined a property — on another key, or another store — notified nobody.

Two more found by probing stores over unusual targets:

- **`createStore(Object.freeze(config))` threw**, and under it a proxy-invariant violation: reading
  any nested object out of a frozen store threw a `TypeError` from the engine.
- **`createStore(x)` twice returned two proxies**, so the same nested object read through each was
  two different values.

**Reads are 13% faster.** The `'proxy-handler'` chain was resolved from a `Map` on every property
read of every store; it is now cached against a registry revision. Measured on
`bench/reactivity.mjs`: a tracked flat read 150 → 131 ns/op, two hops 478 → 442.

Development-only diagnostics, all free in production: a string in tag position is refused rather
than rendered as escaped punctuation; an un-hoisted `_$child$` applier is named; a self-feeding
`useSyncEffect` is stopped at depth 50; and the missing-`@verajs/collections` error is raised once
per page rather than once per read, and from a `size` read as well as a method read.
