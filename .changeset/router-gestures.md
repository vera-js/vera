---
'@verajs/router': patch
---

Relative navigation for components that don't know where they're mounted, without a second
resolution grammar. `resolve()` and `navigate({ name })` fill missing params from the current route
— from `/users/5/profile`, `navigate({ name: 'user-settings' })` goes to `/users/5/settings` with
nothing threaded down; explicit params win, an explicit `undefined` still omits an optional
segment, and with nothing routed yet behaviour is unchanged. A new `currentRoute()` returns
`{ path, params }` page-wide (a copy, Node-safe), so any gesture the shorthands don't cover is
plain string work. Development builds also diagnose the one URL rule that reads as a router bug —
a relative word replacing a `:param` segment — naming both correct spellings.
