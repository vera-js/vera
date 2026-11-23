---
'@verajs/ssr': patch
---

The server's DOM reads the content of `<xmp>`, `<noembed>`, `<noframes>` and `<plaintext>` as text, as every engine
does, when it parses markup assigned through `innerHTML`: a query found elements inside them that a browser never
builds. Their text is still served escaped.
