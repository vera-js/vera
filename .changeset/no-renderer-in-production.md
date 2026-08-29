---
'@verajs/core': patch
---

Say "no renderer wired" in production too, not only in development

Core ships no renderer of its own, so a component that renders with nothing wired produces an empty
page. Three separate mistakes end there — `wire` never called, wired with an import name that
resolved to nothing, or handed something that is not a module — and every one of them was
**completely silent in production**: no warning from `render()`, none from `wire`, nothing anywhere.
A blank page and no explanation.

That matters because **buildless is a first-class mode**. Someone pasting `vera.min.js` into CodePen
from a CDN never runs a development build, so a `__DEV__`-only diagnostic is invisible to exactly the
person most likely to have forgotten the wiring — and this is the framework's most likely first
mistake.

`render()` now warns in both builds. Development keeps the full message with the two lines that fix
it; production carries a short one. Warned **once per process** and only on the failing path, so a
working app never reaches it. Costs 36 gzipped bytes.

Found by running the same behavioural matrix against the development and production builds and
diffing the results — 13 behaviours, one of which differed.
