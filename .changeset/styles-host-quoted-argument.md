---
'@verajs/styles': patch
---

A light component's `:host(…)` rewrite skips an attribute selector inside the argument, so a `)` in its value
(`:host([data-x=")"])`) no longer ends it early and turns the selector into a different one.
