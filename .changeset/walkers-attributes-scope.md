---
'@verajs/ssr': patch
---

Tree walkers, the attribute map's methods, and `:scope`

- **`createTreeWalker` and `createNodeIterator` walk the tree.** Both existed and answered `null` to
  everything whatever the tree held — a stub reporting "no more nodes" from its first call, so a
  component walking its own subtree found it empty and did nothing, on the server only. `whatToShow`,
  filter functions, `acceptNode` objects and the stepping methods all work.
- **`attributes` answers `getNamedItem`, `item`, `setNamedItem` and `removeNamedItem`.** The list is
  a plain array rather than a live `NamedNodeMap`, which is a recorded difference, but its methods
  were simply missing — so `attributes.getNamedItem('x')`, which plenty of existing code uses, was a
  `TypeError` on the server and worked in a browser.
- **`:scope` is supported.** It means the element a query started from, which *is* knowable on a
  server, unlike the pseudo-classes beside it — and it is what makes `querySelector(':scope > b')`
  mean "a direct child", the usual reason to want a pseudo-class in a server render at all. Every
  other pseudo-class still throws rather than reporting no match.
