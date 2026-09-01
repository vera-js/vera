---
'@verajs/core': patch
'@verajs/ssr': patch
---

`renderToString(url, { static: true })` — about 3x, for a page that will not be interactive

A server render is one shot: the subscriptions built while it runs are never fired afterwards, so
tracking every property read to create them is pure cost. Measured on a component rendering twenty
rows, the proxy behind `createStore` is the **entire** reactivity overhead of a server render — about
40 µs against a 15 µs baseline — while effects and the scheduler cost nothing detectable. With
`static` on, `createStore` hands back the object it was given and reads are ordinary property access.

**The markup is identical**, and that is the whole safety of it. It is not asserted on an example:
`tests/ssr-static-mode.test.mjs` renders *every* fixture in the suite both ways and compares markup,
styles and title. A mode that cannot drift is why this is a flag rather than a second renderer.

**A store written to during a static render throws**, naming the option, rather than rendering markup
that reflects none of the writes. That guard is deliberately **not** development-only, unlike most of
this framework's diagnostics: a server runs the production build, so folding it away would remove it
from the only place it matters. It is free — the proxy has no `get` trap, which is where the cost of
a reactive store actually is.

`@verajs/core` gains `setStaticStores`, which is what `@verajs/ssr` calls. It is server-side only:
leaving it on in a browser gives you a framework that does not update.

**Size:** an app that uses `createStore` grows **47 gzipped bytes** (6 026 → 6 073 B), which moves it
from 5th to 6th in the comparative table — 42 B behind Preact, where it was 5 B ahead. An app that
does not use `createStore` is **unchanged at 5 005 B**, because the branch tree-shakes away with the
store it belongs to.
