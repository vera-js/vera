---
'@verajs/ssr': patch
---

Collections answer `item()` and `namedItem()`, and the node constants are on `Node` itself.

`childNodes`, `children`, `querySelectorAll` and the `getElementsBy*` family answer with plain arrays
rather than live collections. That is deliberate — there is nothing to be live over while a render is
a single pass — but `item()` and `namedItem()` went with it, and those were never part of the
reasoning. `list.item(0)` threw `TypeError` from ordinary code, and from any library written against
the DOM rather than against arrays. Both are provided now, matching a real collection: out of range is
`null` rather than `undefined`, and `namedItem` matches in document order.

`Node.TEXT_NODE` and the rest were `undefined`. WebIDL puts a constant on both the prototype and the
interface object, and `node.nodeType === Node.TEXT_NODE` is the ordinary spelling — the constants
reached instances and not the constructor, so that comparison read against `undefined` and was quietly
false for every node.

The array difference is also written into the README, which a source comment claimed it already was.
