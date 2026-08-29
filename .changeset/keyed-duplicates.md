---
'@verajs/renderer': patch
---

A repeated key in a keyed list no longer crashes the render, or silently drops a row.

Duplicate keys are documented as undefined behaviour and stay that way — which of two items keeps
the existing node is not specified. Undefined has to mean *a list*, though, and it meant neither of
these. The key-to-index map holds one index per key, so the second occurrence of a key found the
slot the first had already consumed, and `Cannot read properties of null (reading '_element')` came
out of three frames inside a private algorithm, naming nothing the caller wrote. Fixing only that
revealed the worse half: the map is built once, and the head/tail branches consume items by moving
the pointers without nulling anything, so a repeated key could hand the same item to two positions
and the list rendered one row short of what it held — nothing thrown, page quietly wrong.

Neither is reachable with unique keys. Both need a duplicate *and* a reorder *and* a new key in the
same step, which is why they survived a suite that fuzzes every list mutation: they were found by
fuzzing over a four-key alphabet so duplicates were constant rather than occasional.

Development now warns once per render when a list repeats a key, since it behaves correctly in the
common case and arbitrarily in the rest. `@verajs/renderer/keyed` grows 18 B gzipped.
