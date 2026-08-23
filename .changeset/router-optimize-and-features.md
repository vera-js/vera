---
'@verajs/router': minor
---

Four features, one hot-loop rewrite, and the generic collection helper dropped.

**`meta`** — arbitrary data attached to a route and carried to every guard, action and component on
the snapshot. The router never reads it, which is what lets a guard decide on the route's own terms
(`to.meta.requiresAuth`) instead of re-parsing the path it was handed. Route data was previously
unreachable outside the route's own callbacks.

**`router.currentRoute`** — where that router is now, params and query already parsed. Reading
`location.pathname` gave the string back but not the match.

**Optional params** — `/users/:id?` matches both `/users/5` and `/users`. The slash goes inside the
optional group, so the shorter path routes rather than requiring a trailing slash; an unmatched
optional param is absent from `params` rather than empty.

**`scrollBehavior`** — replaces where the page scrolls to after routing, for a list that should keep
its offset, a view that scrolls its own container, or smooth scrolling. `saved` carries the position
stamped on the entry a back/forward traversal landed on.

**Active links are 1.1–1.2× cheaper**, and cost the DOM writes that matter rather than one per link.
The clear-then-re-add shape rewrote `class` on every routed link on every navigation, because
`classList.remove` runs its update steps whether or not the token was there — 80 attribute writes
for a 40-link nav bar to change two. `toggle(token, force)` already writes only on a real change,
and `removeAttribute` on an absent attribute is a no-op.

The generic `get` chaining helper from `@verajs/shared-utils` is gone from this package, replaced by
a local get-or-create. Its Array branch, `instanceof` helper and throwing fallback were all inlined
into the standalone bundle and none of them were reachable — 58 B gzipped.
