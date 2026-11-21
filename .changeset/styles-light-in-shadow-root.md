---
'@verajs/styles': patch
---

A light-DOM component rendered inside a shadow root is styled there: its `@scope (tag)` sheet is adopted by that root
(the document's sheets stop at its boundary), once per class per root, kept when the root's own component replaces its
sheets, and adopted again after a move into another document. Server-rendered, such a component is unstyled until
hydration (its block goes to the page `styles`).
