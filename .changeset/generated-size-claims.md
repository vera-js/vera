---
'@verajs/autoloader': patch
'@verajs/core': patch
'@verajs/inserts': patch
'@verajs/renderer': patch
'@verajs/router': patch
---

Correct the published size figures and generate them from the build instead of maintaining them by
hand. Every `~N KB gzip` claim in a package README is now produced by `scripts/sync-size-claims.mjs`
from the actual `dist` bundle, and CI fails if any of them drifts.
