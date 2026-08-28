---
'@verajs/ssr': patch
---

The collection queries, `isEqualNode`, `normalize` and composed `getRootNode`

Four more members that answered a constant because there was nothing to look at, and became wrong
the moment a tree existed:

- `getElementsByTagName`, `getElementsByTagNameNS` and `getElementsByClassName` returned `[]`
  whatever the tree held. They answer from it now — plain arrays rather than live `HTMLCollection`s,
  which is already a recorded difference: there is nothing to be live *over* in a single render pass.
- `document.querySelector`, `getElementById`, `getElementsBy*` and `getElementsByName` searched
  nothing at all, so `document.getElementById('x')` was `null` for an element appended to `body`
  moments earlier. Each walks `documentElement` then `body`.
- `isEqualNode` compared **identity**, which is what `isSameNode` is for — two elements built
  identically reported themselves different. It compares type, name, attributes as a set, and
  children pairwise now.
- `normalize()` was a no-op because there were no text nodes to merge. Appending two of them left
  two children where a browser leaves one.
- `getRootNode({composed: true})` ignored `composed` and stopped at the shadow root instead of
  continuing out through the host.

Each is compared against jsdom performing the same operation in `tests/ssr-tree-operations.test.mjs`.
