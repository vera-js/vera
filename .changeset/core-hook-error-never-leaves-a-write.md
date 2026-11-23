---
'@verajs/core': patch
---

A hook's error never leaves a write: an `'error'` handler that rethrows, under a `'sync'` effect or a scheduler that
runs the flush at once, no longer stops the write before every later subscriber hears it. The error is reported as
uncaught, as the default scheduler's flush reports it; `flush()` still throws it.
