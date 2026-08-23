---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

DOM nodes render at a child position, and two server/client disagreements are fixed.

`${someNode}` used to coerce to `[object HTMLSpanElement]`; it now renders the node itself, in
arrays and `keyed()` lists too. That is what lets a template hold something another library owns — a
charting canvas, a map container, an editor instance — without an element ref and a manual
`append()`. It costs the renderer 23 B gzipped.

`hydrate()` no longer throws on a value the server cannot have rendered. An opaque object at a child
position reached a spread of a non-iterable and raised `TypeError: value is not iterable`, which
escaped the mismatch guard and out of `render()` — where every other disagreement with the server
degrades quietly to a clean client render. A client-only DOM node now adopts without giving up
hydration at all: the server rendered nothing for it, so the node is inserted and the surrounding
server DOM is still adopted in place.

`@verajs/ssr` serializes `false` at a child position as the text `false`, matching the client
renderer and lit-html. It used to emit nothing, so `${cond && 'x'}` produced different content on
the two paths — invisible on a static page, and a discarded hydration on a server-rendered one.
