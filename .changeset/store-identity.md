---
'@verajs/core': patch
---

Assigning a nested object back into its own slot is no longer treated as a change.

The set trap read the previous value off the raw target while the getter hands out that object's
proxy, so `state.o = state.o` compared proxy against raw, notified every subscriber that nothing had
happened, and wrote the proxy into the target — where code still holding the object the store was
built from saw its own property stop being what it passed in.

The idiom it cost is the common one. `state.items = update(state.items)`, where `update` returns its
input untouched when there is nothing to do, is how "no change" is normally written, and it bought a
render pass every time with no symptom other than work nobody asked for. The primitive half of the
rule was already there — `state.n = 1` was correctly quiet — which makes this a gap rather than a
decision.

Core grows 11 B gzipped. Primitive writes are unaffected (the check short-circuits on `typeof`);
an object-identity write costs one `WeakMap` lookup, measured at 5.4 ns.
