---
'@verajs/renderer': patch
'@verajs/core': patch
---

`@verajs/renderer/native-elements` — built-in hosts get a custom element's lifecycle

`wire([renderer, nativeElements])` lets `init(div, setup)` on a built-in element (a `div`, a `section`…) behave like a
custom element: torn down when removed, set up again when re-added, kept on a move, and set up at its first connect
when `init` ran off the page. Without the module, development warns once that such a host is never released.

Core: an `'init'` insert now receives the setup as its third argument and may answer `false` to defer it.
