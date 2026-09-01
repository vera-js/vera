---
'@verajs/core': patch
---

Stop allocating a closure on every tracked read

`addCallback` ends with `prioritySlot(byPriority, order, priority, () => new Set())`, and that arrow
was built on **every tracked property read** while only ever being called on the first one — directly
contradicting the comment two lines above it, which says the steady state is allocation-free. It was
not. `createHook` carried the same shape.

Found by heap-profiling a server render, where the proxy's `get` trap accounts for **43% of all
allocation per render**: on a server every render is cold, so the subscription graph is built once and
discarded, and nothing reaches the steady state the hot path is tuned for.

Hoisting the factory to a module constant is behaviour-identical — `prioritySlot` still takes a
factory so the slot is built only when missing, which is worth keeping; only the factory stops being
rebuilt. Measured on the SSR component render, fastest of nine rounds over 20 000 renders, twice:
**6.14 and 6.37 µs against 6.73 and 6.79** inline. 7 B gzipped.
