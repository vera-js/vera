---
'@verajs/inserts': patch
'@verajs/store': patch
'@verajs/styles': patch
---

Every public export now has a copyable call shape in its README

An export-vs-docs audit over the true public surface (each exports entry's own declarations) found
exports that were named in prose or tables but never appeared inside a code fence anywhere — a
reader had no call to copy. `revision` and `inserts` (inserts), `collectionMethod` and `GLOBAL`
(store, with the real five-argument insert signature and the fact that core calls the chain's
first entry and caches it), and `adoptStyles`/`applyStyles` (styles) now carry fenced usage
written against the source.
