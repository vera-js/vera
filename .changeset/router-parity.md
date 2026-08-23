---
'@verajs/router': minor
---

Everything Vue Router or React Router has that this did not. Three of these change behaviour.

**Nested routes render the whole chain** (breaking). `children` prefixed paths and nothing else:
`/settings/profile` rendered the child alone and the parent's `component` never ran. It now renders
outermost first, each level into an outlet the level above rendered — the settings layout into the
router's outlet, the profile view into the `<section view="main">` that layout produced. A view name
is resolved *inside* the level above, so a nested outlet may reuse the router's own name. A parent
that renders no matching outlet stops the route, and says so in development.

**The most specific route wins** (breaking), not the first registered. A static segment outranks a
`:param`, a required param outranks an optional one, and a `*wildcard` ranks below everything, summed
over the pattern. `/users/new` now beats `/users/:id` and a catch-all sits last wherever it was
declared. React Router ranks the same way, and for the same reason: which line a route went on
should not decide whether it is reachable.

**`beforeEnter`** — a guard for one route, run after the router's `before-route` handlers and before
its `action`. On a nested route the chain runs outermost first, so a parent can refuse before a child
does any work.

**`alias`** — one route reachable at other paths, keeping whichever URL was used. Relative to the
parent exactly as `path` is.

**`removeRoute(name)`** — the inverse `addRoutes` never had, for a route that arrives with a
permission or a feature flag. Takes the route's aliases with it.

**`back()`, `forward()`, `go(n)`** exported alongside `navigate`.

**Relative hrefs on routed links** (breaking), resolved as the browser resolves them: from
`/docs/intro`, `href="edit"` is `/docs/edit`. Deliberately not React Router's `<Link to>` semantics,
which would give `/docs/intro/edit` — a `route` attribute must not change where a link points, or the
same markup would go to two different places depending on whether the script ran. A cross-origin
href is now left to the browser instead of being hijacked and dead-ended.
