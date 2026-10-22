---
'@verajs/store': patch
---

`resource()` — async data as a reactive cell, at `@verajs/store/resource` (also exported from the package root)

`resource((signal) => fetchUser(state.id, { signal }))`, created in a component's setup, is a cell of `loading`,
`value`, `error` and `refreshing` that a render reads like any store. When what the source read changes, the previous
request is aborted and the source runs again; only the latest request ever writes, and an aborted request is not an
error. A refetch keeps the previous value on screen. Removing the component aborts the request in flight. On a server it
does not fetch: the page renders the loading state. 390 B gzip, and nothing added to an app that does not import it.
