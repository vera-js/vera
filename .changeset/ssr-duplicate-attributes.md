---
'@verajs/ssr': patch
---

A repeated attribute is its first occurrence on the server, as every parser reads it: the DOM's `getAttribute` on
parsed markup and a nested component rebuilt from its open tag kept the last one.
