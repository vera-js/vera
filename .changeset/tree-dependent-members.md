---
'@verajs/ssr': patch
---

The tree-dependent members answer from the tree

`nextSibling`, `previousSibling`, `nextElementSibling`, `previousElementSibling`, `contains` and
`getRootNode` all returned a hardcoded `null`/`false`/self. That was truthful while a child was
flattened into its parent's markup — there was no sibling to find and no chain to walk — and became
wrong the moment child nodes were retained. `element.nextSibling` reported nothing for the middle of
three children, and `host.contains(child)` read as "this is not mine" for a child the host plainly
held.

Each answers from the real tree now.
