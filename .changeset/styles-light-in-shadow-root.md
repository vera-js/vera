---
'@verajs/styles': patch
---

A light-DOM component rendered inside a shadow root is styled there: its `@scope (tag)` sheet is adopted by that root
(the document's sheets stop at its boundary), once per class per root, kept when the root's own component replaces its
sheets, and adopted again after a move into another document. Server-rendered, `@verajs/ssr` 0.3.7 serves the block
inside each declarative shadow root the component renders in.
