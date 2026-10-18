---
'@verajs/core': patch
---

A store array's `splice`, `shift`, `sort` and other whole-array methods notify once, after they finish

Called through a store, `rows.splice(4, 1)` on ten rows wrote them back one index at a time, and a hook
that runs on every write — a raw `createHook`, or `useSyncEffect` — ran between those writes: seven
times, six of them on a half-shifted array holding one row twice or a hole. `splice`, `push`, `pop`,
`shift`, `unshift`, `sort`, `reverse`, `fill` and `copyWithin` now run whole on the array and then tell
each subscriber once, so a synchronous hook only ever sees the finished array. Queued hooks (a
component's render) already ran once and saw the end state; what they skip now is the per-index
bookkeeping. What the methods return is unchanged: the store array itself, or the same proxies a read
would hand back.
`sort`'s comparator still receives the store's proxies; a comparator that writes to the store is heard mid-sort, as any
write is, so keep comparators pure. One idiom keeps the old behavior, because it never reads the
method through the store: `Array.prototype.push.apply(state.rows, more)` — write `state.rows.push(...more)`.
