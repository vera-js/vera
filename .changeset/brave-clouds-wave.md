---
'@verajs/router': patch
---

Say which of the two guard redirects settles inside the promise `navigate()` returns.

The warning for a `beforeEnter` that returns a path offered two fixes as interchangeable: "use the
`redirect` route option, or call `navigate()` and return false". They are not. Measured from `/a`:

| | after `await navigate('/guarded')` |
| --- | --- |
| `redirect: '/b'` on the route | already at `/b` |
| guard calls `navigate('/b')`, returns `false` | still at `/a` — `/b` a task later |

`redirect` is handled inside that navigation, so the promise covers it. A guard calling `navigate()`
starts a separate navigation the promise knows nothing about; awaiting it reports only that the
guarded route was cancelled. That matters because the README makes awaiting the supported way to
handle an outcome.

Documentation only — no behaviour change. The README gains the same table, and the asymmetry is now
asserted rather than described.
