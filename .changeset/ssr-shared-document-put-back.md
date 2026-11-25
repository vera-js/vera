---
'@verajs/ssr': patch
---

What every render shares is put back when it ends, as the title already was: the `<html>` and `<body>` elements and
their attributes (`lang`, a body flag), and `document.cookie` (still `undefined` until a render writes it). A value one render's component set
there was what the next render's components read, whether the render finished in time or had timed out with work
still running; such late writes are now refused. A page module's own top-level writes stay.
