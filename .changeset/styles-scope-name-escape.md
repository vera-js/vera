---
'@verajs/styles': patch
---

A light component whose name holds `.` (`x-a.b`, a valid custom element name) is styled: its `@scope` selector
escapes the name, where `@scope (x-a.b)` had read `.b` as a class, styling nothing inside `<x-a.b>` and styling an
`<x-a class="b">` instead.
