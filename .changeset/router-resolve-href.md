---
'@verajs/router': patch
---

`resolve(name, params)` returns the mounted path under a base — `/app/users/5` rather than
`/users/5` — so its result goes straight into an `href`. `navigate()` accepts it unchanged, because
every path it is given is resolved and stripped, so one return value is now correct in both places.
At the origin root it is the same string it always was.

Development builds also warn when a routed link's `href` points outside the base. Such a link
navigates correctly, because the router re-bases what it writes to history, and is a wrong URL
everywhere the router is not involved.
