---
'@verajs/renderer': patch
---

The `hold` documentation no longer claims a scroll offset survives.

It listed "a scroll offset" among what `hold` preserves. Every engine resets `scrollTop` to zero the
moment an element leaves the document — measured on Chromium, Firefox and WebKit, which report `0`
while the subtree is parked, `0` on return, and `0` even for a node moved directly between two
attached parents. Nothing a directive does with the nodes can hold it, and lit's `cache()` cannot
either, so the claim was impossible rather than unimplemented.

Everything else it lists does survive, and is now asserted in a browser with a control that toggles
the same subtree *without* `hold` — because the claim is not that state survives, it is that `hold`
is what makes it survive.

Documentation only; no behaviour changed.
