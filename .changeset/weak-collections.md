---
'@verajs/core': patch
---

Make `WeakMap` and `WeakSet` reactive.

They were the one collection gap against Vue, which supports all four. Mutating one in a store used
to succeed and simply not re-render, leaving the DOM stale — a silent staleness rather than an error.

The obstacle was never the proxying, it was where dependencies live. Per-key dependencies are keyed
by the collection's own entry keys, and the ordinary `Map` container would have held every tracked
key alive for as long as the collection — exactly the retention the weak types exist to avoid.
Supporting them naively is a memory leak, which is worse than not supporting them.

A weak collection now gets a `WeakMap` container instead, chosen once on the first tracked read so
the hot path never pays for the check. The two shapes stay interchangeable because only `get` and
`set` are ever called on the container, and a weak collection never reaches the string `'_global'`
channel: `set`/`add`/`delete` *notify* it, which is a `get` and misses harmlessly, while only
`entries`/`keys`/`values`/`forEach` *track* it — and none of those exist on a weak collection.

Proven weak rather than assumed: three keys tracked, dereferenced and collected under
`--expose-gc`. Per-key precision holds — a key nothing read does not re-run — and object-keyed
regular `Map`s keep the strong container and their `size` channel.

`Date` and `RegExp` remain unproxied, as they are in Vue. Their methods read internal slots, so a
bare proxy throws, and reactivity would mean wrapping every mutator for a case whose idiom is
replacement: `state.when = new Date(t)` is a property write and already reactive.

Costs **30 B gzipped** in core. (Stated as a delta rather than a before-and-after: several changes
release together, so an absolute figure written here would be wrong by the time it publishes.)
