---
'@verajs/renderer': patch
---

A root render owns its range, never its container

`renderInto(result, container)` used to anchor its root on one marker whose range ran to the end of the
container, so a node other code appended after the first render — a script's, or a browser extension's in
`document.body` — was cleared by the next template swap along with the render's own content. The root is now
bracketed by two markers like every other position: content before and after the render survives every
re-render, and hydration bounds its root the same way.
