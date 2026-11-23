---
'@verajs/core': patch
---

Faster component creation and updates. A `define` element's props record starts out known as a plain data record, so
its first write no longer scans every prop's descriptor.
