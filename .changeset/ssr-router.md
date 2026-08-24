---
'@verajs/ssr': patch
---

A routed component can be server-rendered.

`initRouter` threw `window is not defined`, so the app shell of every routed app — the exact thing
server rendering exists for — could not be rendered at all. The shim now provides enough `window`,
`location` and `history` for the router to initialise; listeners are accepted and never fire, because
nothing navigates on a server.

The shadow-root shim gained the surface that exposed: `querySelectorAll`, `addEventListener`,
`dispatchEvent` and `host`. It had been built to "the smallest surface the renderer touches", which
is the same wrong bar that left the element shim without `dispatchEvent` and `classList`.

The shell renders — nav, outlet, everything the component draws. A route's own content does not,
because the server holds markup as a string rather than a tree and the router finds its outlet by
query. Render the route yourself and pass it as `children` if it must be in the first response.
