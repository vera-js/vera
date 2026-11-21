---
'@verajs/ssr': patch
---

The server DOM has `labels` on every labelable element (`input`, `button`, `select`, `textarea`, `meter`, `output`,
`progress`): the `<label>`s whose labeled control it is, by HTML's rule, `null` on an `<input type=hidden>`, as in
every engine. It read `undefined`, so server code treated a control named by `label[for]` as unnamed.

Generated ids (`@vera-hooks/labeled` and every hook counting through the shared id counter) restart at each render, so
one page serves the same markup on every request; before, the count ran on for the life of the process. Ids are unique
within a render: render a page in one call, or its ids can repeat.
