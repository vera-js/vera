---
'@verajs/ssr': patch
---

Five tree-mutation defects in the SSR DOM, found by fuzzing sequences against jsdom.

Every member of this DOM already agreed with jsdom when called on its own. These only appear in
sequences, and three of the five are one root cause — the file treated a node and its own argument as
necessarily different, and every one of these operations allows them to be the same.

- `insertBefore(x, x)` ignored the spec's "if referenceChild is node, set it to node's next sibling",
  so the detach that followed made the index lookup fail and `x` landed at position `n - 2`. With two
  children it went first, with five second-to-last, and **with three it was correct** — which is the
  size a hand-written case uses. Reached in practice by `x.after(y)` where `y` already follows `x`.
- `replaceChild` was the only insertion path with no ancestor check, so a node could be made to
  contain itself.
- `prepend` moved the existing children aside and destroyed all of them if `append` then threw.
- `x.replaceWith(x)` deleted `x`.
- `x.replaceChild(x, x)` moved `x` to the end and destroyed the last child.

The last two are silent data loss on a server: a failed or no-op call that removes content.
