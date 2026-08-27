---
'@verajs/renderer': patch
---

Stop shipping a development-only `WeakMap` to production

Every read of `_directiveSwaps` — the counter behind the "a child directive changed identity" warning
— sits behind `__DEV__`, and the comment above it said production carried neither it nor a per-part
slot to hold it. Half of that was true. A bare `new WeakMap()` at module scope is a constructor call
the minifier must assume has side effects, so the dead branch took the *reads* and left the
*allocation*: `vera-renderer.min.js` contained a literal `new WeakMap;` statement building an object
nothing could reach.

Marking it `/* @__PURE__ */` lets the branch take it along. 2 B off `@verajs/renderer` and 3 B off
`@verajs/renderer/hydrate` — small, but it is an object allocated on every page load for a warning
that build cannot print, and the comment claiming otherwise was the more expensive part.

Found by sweeping all 14 production bundles for orphaned allocations after the same pattern turned up
in `@verajs/core`; the sweep is now clean.
