---
'@verajs/router': patch
---

An outlet or a view element from another window (an iframe, a popped-out window), adopted or not, is recognized as an
element: it is told by its node type, never by `instanceof` a DOM class. Before, such a view was read as a route name,
so a root route painted nothing and a nested level painted over its parent.
