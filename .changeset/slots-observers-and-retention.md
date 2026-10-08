---
'@verajs/renderer': patch
---

Light-DOM slots no longer keep removed hosts alive, and stop slowing down as hosts come and go

Every light host slots had ever captured stayed reachable after it was removed from the page, and every
distribution pass walked them all — so an app that keeps replacing light-slot components (routes, lists) leaked them
and got slower each time. Measured in Chrome with real garbage collection: 30 of 30 removed hosts stayed alive;
now none do beyond what the same page keeps without slots. In Firefox each new light host also paid for every one
created before it (a shared `MutationObserver` that Firefox searches linearly): 2000 hosts went from ~260 ms to over
9 s across eight renders; it is now flat, ~100 ms. Chrome and WebKit are unchanged or faster.

One timing detail moved: a light host changed directly by your code (`host.append(node)`, `node.slot = 'x'`), followed
in the same task by an unrelated component's render, is now redistributed at the next microtask rather than by that
render. Anything a template does is still distributed by the end of its render, and reading through `slotted()` or
`slot.assignedNodes()` is always current.
