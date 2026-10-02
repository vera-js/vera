---
'@verajs/ssr': patch
---

`renderToStringAsync` never waits for ever on a component's promise: a `timeout` option, 2000 ms by default

An asynchronous render awaited an `async connectedCallback`, and every promise a frame callback returned, with no
limit. One that never settled, such as a wait on a child component the server never defines or a forgotten
`new Promise(() => {})`, held the request open for ever. Renders take turns, so it held every request after it as
well, and the server stopped answering. Each wait now races the render's budget, the new `timeout` option
(milliseconds, 2000 by default, counted from the start of the render's turn). When the budget runs out, the render
serves what it has rendered and warns, in every build, naming each component whose wait was cut, because the page
served is not the one its code describes. A wait shorter than the budget is waited for, exactly as before. `timeout: 0` waits for
nothing; there is deliberately no setting for an unlimited wait. Synchronous `renderToString`
awaits nothing and is unaffected.
