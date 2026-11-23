---
'@verajs/core': patch
'@verajs/renderer': patch
---

A light component that renders no `<slot>` and reads its own children can say so: `static ownsChildren = true` on its
class, or `define({ tag, ownsChildren: true })`. On a page that wires `@verajs/renderer/slots` for other components,
slots then never moves that component's children into its unassigned carrier, at init or at a render's end, so the
component still finds the children it reads. A component that declares it and renders a `<slot>` is told once in
development (`owns-children-slot`). Nothing changes on a page without slots.
