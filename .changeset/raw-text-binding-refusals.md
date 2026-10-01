---
'@verajs/renderer': patch
---

Two binding shapes that never rendered are refused in development

Inside `<svg>`/`<math>`, a `<title>` or `<style>` holding an element and a binding lost the binding: the renderer reads
those tags as text and rebuilt the text around the binding, destroying the element. A binding inside `<xmp>`,
`<noembed>`, `<noframes>` or `<plaintext>` never rendered either, with a misleading warning that the parser had dropped
the element. Both now throw in development with what to write instead; text bound directly in an SVG `<title>`
renders as before, and production is byte-identical.
