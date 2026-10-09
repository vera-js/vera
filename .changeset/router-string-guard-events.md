---
'@verajs/router': patch
---

Development now warns when a `before-route` or `before-leave` handler returns a string, as it already did for
`beforeEnter`. A returned path does not redirect — a string is truthy, so the navigation is allowed, which in an auth
guard defeats the guard. The message names the event and the path, and the fix: call `navigate(path)` and return
`false`.
