---
'@verajs/ssr': patch
'@verajs/router': patch
---

`renderToStringAsync` — a render that waits for the component

`renderToString` is synchronous end to end, so an `async connectedCallback` is refused: its markup
would be empty, and saying so beats shipping it. `renderToStringAsync` waits — for the callback, and
for promises to settle between frame rounds.

Two things that were impossible now work:

- **A component that loads data renders with it.** `async connectedCallback` is awaited.
- **A routed component renders its route.** Its first navigation is scheduled on a frame and is
  asynchronous, so the markup used to be serialized while the route was still resolving and the
  outlet went out empty. The first view is now in the first response instead of only after
  hydration. `@verajs/router` returns the promise from that frame callback rather than dropping it,
  which is what gives anything a chance to wait for it.

**The two chains share what decides *what* to emit** — the scanner, the serializer, the instance
preparation, the page assembly — and differ only in when they may wait.
`tests/ssr-async-parity.test.mjs` renders every fixture through both and compares markup, styles and
title, because two paths that must agree forever is the failure this package has spent a week
deleting.

The scan stays synchronous in both: a component tag becomes a placeholder and its render a promise,
and the placeholders are substituted once everything settles. Awaiting inside the scan would have
meant a second copy of the parser, and an async recursion measures **2.45x even when nothing
suspends** — which the synchronous path is not going to pay for a feature it never uses. A generator
driven two ways, which is how Lit does it, measured **6.31x** and was rejected for the same reason.

**Asynchronous renders take a turn each.** The per-render bookkeeping is module-level, and being
synchronous end to end is what makes concurrent `renderToString` calls safe; a render that pauses
does not have that protection. One at a time is the version that cannot be wrong, and it costs
concurrency only between *asynchronous* renders. `renderToString` is untouched.
