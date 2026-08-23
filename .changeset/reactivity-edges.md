---
'@verajs/core': patch
---

Notify on array appends and on `delete`. **Two reactivity bugs.**

**Appending to an array moved `length` without reporting it.** Assigning `list[3]` on a
three-element array updates `length` as an internal consequence, so nothing passes through the `set`
trap for `length` and a hook that read it was never told. `push` and `unshift` were silently inert;
`splice` and `pop` worked, because those assign `length` explicitly. A list rendered from
`items.length` simply stopped updating when you appended to it, with no error.

**Deleting a property notified nothing at all.** The `deleteProperty` trap returned success without
running callbacks, so a hook reading that property kept the value it last saw.

Both are fixed at the trap. Precision is unchanged and asserted: an append does not wake a hook that
read only `list[0]`, a non-index key on an array is not treated as growth, deleting an absent or
unread property stays silent, and an explicit `length` write still notifies exactly once.

Costs 63 B gzipped.
