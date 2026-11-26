---
'@verajs/ssr': patch
---

A binding that writes nothing after a `/` in a tag no longer makes the served tag self-closing. A binding takes the
space before its name, so `<g/ @click=${fn}>` (and a dropped `.prop`, a false `?bool`, a refused handler, a nullish
value or a ref in element position) was served `<g/>`, which in SVG and MathML closes the element, so its children
were served after it while the client kept them inside. A `/` there now keeps one space after it, which no parser
reads as self-closing, and an unquoted value ending in `/` (`a=x/`) keeps its `/`.
