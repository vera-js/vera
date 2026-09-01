---
'@verajs/ssr': patch
---

`insertBefore`, `replaceChild`, `moveBefore`, `cloneNode` and `compareDocumentPosition`

All five were out of scope for one reason — *"needs a tree"* — which stopped being true when child
nodes started being retained. Each is now implemented and compared against jsdom performing the same
operation, error cases included, in `tests/ssr-tree-operations.test.mjs`.

`cloneNode` produces a copy that shares nothing with the original — the aliasing risk that kept it
out of scope — and carries the source text along, so a cloned subtree still reproduces the markup it
was parsed from. It lives on the element: the platform refuses to clone a shadow root.

`moveBefore` has no jsdom to compare against, so its rule was measured on Chromium and Firefox, which
agree on all of it (WebKit does not implement it yet). A node with **no parent** is a
`HierarchyRequestError`, while a *parented* node with a reference that is not a child here is a
`NotFoundError` — different errors from the same call depending on which argument is wrong.
