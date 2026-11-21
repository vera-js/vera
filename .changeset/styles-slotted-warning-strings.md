---
'@verajs/styles': patch
---

Development: the `::slotted()` warning for a light-DOM component reads comments and strings in one pass, so a `/*`
inside a string (`content: "/*"`) no longer hides a real `::slotted()` after it and silences the warning.
