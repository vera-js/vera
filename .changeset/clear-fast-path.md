---
'@verajs/renderer': patch
---

Make the whole-parent `clear` fast path actually fire for lists inside templates.

`ChildPart._clear()` replaces per-node removal with a single `parent.textContent = ''` when the
part owns the parent's entire contents. Its condition was `_start` is the first child **and**
`_end === null` — but since 0.1.2 a part nested in a template always owns an end marker, so
`_end === null` only ever matched a *root* part. Every list written the ordinary way,
`<tbody>${rows}</tbody>`, silently took the slow path.

The condition now also accepts "`_end` is the last child", which is the same ownership property
stated for a part that carries its own boundary, and both anchors are re-appended afterwards.
Verified by counting `removeChild` calls: clearing 500 rows from a `<tbody>` went from 500
individual removals to zero.

Costs 9 B gzipped.
