---
'@verajs/store': patch
---

`@verajs/core` is a peer dependency of the store

The store used to install its own copy of core when the app's core did not match its range, and two cores on one page
leave the store's reactivity silently dead: writes reach one copy and subscriptions live in the other. Core is now a
peer dependency, so npm reports a mismatched core at install instead of installing a second copy.
