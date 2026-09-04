---
'@verajs/router': patch
---

Mount the app at a subpath. Routes stay written at the root (`/users`, not `/app/users`) and the
base is added when the router writes to the address bar, stripped when it reads one back. It comes
from `<base href>`, or from `setBasePath('/app')` for an app that does not want `<base>` rebasing
its assets as well.

Also fixes link resolution: a clicked link now resolves through `document.baseURI` rather than
`location.href`, which is what the browser does. The two differ exactly when a `<base>` is present,
so on such a page a relative `<a route href>` used to send the router somewhere other than where
the browser would have gone.
