---
'@verajs/core': patch
---

`effect()` throws at the call when given a non-function callback

Previously `effect(undefined)` was accepted and failed later, at its first run, far from the line that caused it. It
now throws a `TypeError` at the call, in development and production alike, coded `callback-not-function`: the usual
cause is passing a function's result (`effect(fn())`) instead of the function, or a callback read from options that is
undefined.
