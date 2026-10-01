---
'@verajs/ssr': patch
'@verajs/renderer': patch
---

Security: a nested template cannot change how its parent's markup parses

The client parses every template on its own and closes whatever it left open at its end; the server concatenated
them. So a child template that left an `<svg>`, a comment, a `<style>` or a `<textarea>` open, or that ended inside
a tag, changed how the browser read the parent's following markup, and a raw-text value there could become
elements. The server now closes, at each template's end, everything that changes how the rest of the page parses,
which is what the client already did. It refuses a template that ends inside a tag (the client refuses it too, in
development) and a template rendered inside a text-only element such as `<textarea>`. `<noscript/>` and
`<template/>` now open their element on the server, as the HTML parser reads them.
