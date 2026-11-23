---
'@verajs/core': patch
---

Development's render-loop warning names a hook owned by a plain object (a module's `effect`) without a tag, where it
printed "on <undefined>".
