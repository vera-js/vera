---
'@verajs/core': patch
---

An element that removes itself inside its own effect still runs that effect's cleanup

`disconnectedCallback` runs every cleanup and clears the set. A cleanup is registered when the effect
*returns*, so an effect that calls `this.remove()` — a toast dismissing itself, a component that
redirects — finished **after** that sweep and added its cleanup to a set nothing would ever drain
again. The interval, listener or subscription it was meant to release ran forever, silently: exactly
the failure the cleanup registry exists to prevent, reached by the one ordering that steps around it.

A cleanup registered after the sweep now runs immediately, which is what the teardown would have done
a moment earlier.

The element is tracked as removed rather than tested with `isConnected`, because a component rendered
into a detached container has never been connected and is still owed a later removal.
