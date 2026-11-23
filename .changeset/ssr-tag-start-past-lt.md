---
'@verajs/ssr': patch
---

A bound attribute written again in a tag whose static text holds a `<` in a name or an unquoted value
(`<b id=a title=x<c id=${v}>`) replaces the earlier write, as `setAttribute` does on the client: the server found the
tag by its last `<`, missed the earlier `id=a`, and served it first, so the page read `a`.
