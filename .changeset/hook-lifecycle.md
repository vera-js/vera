---
'@verajs/core': patch
---

Warn in development when a component registers hooks but never calls `render()`.

`render()` is what drives the first pass: it calls `runHooks()` and then clears the current
instance. A component that registers effects and never renders therefore does nothing at all — the
hooks exist and nobody runs them. Silent, and easy to write, because a component whose whole job is
a side effect (analytics, syncing, focus management) has no obvious reason to render markup.

Detected without adding state: if the element is still the current instance once the synchronous
`connectedCallback` has finished, `render()` was never reached. A component mounting after this one
moves that pointer, so the check can miss a case but cannot invent one. `__DEV__`-only — the
production bundle is unchanged at 2 680 B and contains neither the check nor the message.

`tests/core-hook-lifecycle.test.mjs` covers the rest of the lifecycle alongside it: cleanup on
removal, no renders while detached, four attach/detach cycles leaving exactly one live hook, error
isolation across hooks in both directions, and `untrack`.
