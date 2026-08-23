---
'@verajs/router': minor
---

Five navigation defects fixed, two of them breaking.

**A newer navigation now supersedes an older one.** Every `await` in a route change — a guard, an
`action`, a `component` that fetches — was a point where the user could click elsewhere, and the
slower earlier pass finished last and won: the app landed on the route the user had abandoned, in
both the view and the URL, with nothing reported. Each pass now takes a ticket and stops at its next
checkpoint once a newer one exists, committing no render, no history entry and no title.

**Params are percent-decoded** (breaking). `/u/John%20Doe` handed components the literal string
`John%20Doe`, so every param carrying a space, slash or accent was wrong — while the code's own
comment promised path-to-regexp's structure, which decodes. Wildcard segments decode individually. A
malformed escape yields the raw text rather than throwing out of routing.

**Route events reach the router element, and `preventDefault()` works** (breaking). `vera:*` events
were dispatched on `element.ownerDocument`, so a listener on the router element never fired, and
`bubbles`, `composed` and `cancelable` were all inert. They are dispatched on the element now: they
bubble to document as before, cross shadow boundaries, and cancelling either `before-` event cancels
the navigation, exactly as a handler returning `false` does.

**`navigate(path)` defaults to a real navigation.** Omitting the trigger routed the view while
silently leaving the URL behind — invisible to TypeScript users, a trap for plain JS.

**Routes are matched once per navigation, not twice.** The redirect scan discarded the match it had
just computed and the routing pass recomputed it, so every route's `RegExp` ran twice and a `path`
function was called — and its pattern recompiled — twice as well.
