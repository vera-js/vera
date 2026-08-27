---
'@verajs/core': patch
---

Fold a subscription's priority order in beside its callbacks

`addCallback` kept each element's priority-ordered callback sets in one place and the parallel
priorities in a **separate `WeakMap` keyed by that array** — so every tracked read paid a
`WeakMap.get` to recover something only the insert path ever looks at. `runCallbacks` walks the slots
by index and never consults the order at all; the comment above the declaration claimed otherwise.

They are one fact, so they now travel together as `PropSubscriptions`: one object where there were two
arrays and a `WeakMap` entry.

Worth ~10% of a server render — **5.53 and 5.54 µs against a baseline of 6.16 to 8.40**, fastest of
nine rounds over 20 000 renders, with the baseline re-measured after restoring. The folded runs are
also markedly tighter, which is the allocation showing up as GC variance. A client micro-benchmark
that reads one property 200 000 times sees no change at all, and that is the point: it is maximally
cache-friendly, while every subscription on a server is built cold and thrown away.

2 B gzipped.
