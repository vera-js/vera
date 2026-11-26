---
'@verajs/core': patch
---

With a scheduler that runs the flush at once, a hook's error reaches the `'error'` chain once. A handler that rethrew
it used to hear it a second time, through the write that asked for the flush. It is now thrown as uncaught, as the
default scheduler leaves it, and the write no longer throws.
