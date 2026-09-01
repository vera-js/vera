---
'@verajs/ssr': patch
---

A `<slot>` reports what it projects

`assignedNodes`, `assignedElements` and `assignedSlot` answered nothing for every node, so a
component inspecting what it had been handed found an empty list and rendered its fallback content —
on the server only, where a browser would have shown the real thing.

All of it is answerable here: the host, its children and their `slot` names are all present. Named
and default slots both work, and `assignedNodes({flatten: true})` falls back to the slot's own
content when nothing is assigned.

`assignedNodes` and `assignedElements` are **only on a `<slot>`**, as they are in a browser, where
they live on `HTMLSlotElement`. Defining them as ordinary methods put them on every element, so
`typeof element.assignedNodes === 'function'` — the ordinary way to ask whether something is a slot
— answered yes for a `<div>`.
