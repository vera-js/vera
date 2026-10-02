---
'@verajs/ssr': patch
---

A `<style>` inside `<svg><foreignObject>`, `<math><mi>` and the other HTML integration points is raw text, as the browser reads it

Inside `<svg>`/`<math>` the server escapes every value, because a `<style>` there is a foreign element whose content
is markup. But the browser reads the content of an HTML integration point as HTML: SVG `<foreignObject>`, `<desc>`
and `<title>`, MathML `<mi>`, `<mo>`, `<mn>`, `<ms>` and `<mtext>`, and an `<annotation-xml>` with an HTML
`encoding`. So a stylesheet there was served escaped (`.a > .b` as `.a &#62; .b`) until hydration replaced it. The
server now tracks them, each only in its own namespace (`<math><foreignObject>` and `<math><svg>`'s children stay
MathML), only when not self-closed, and with `<mglyph>`/`<malignmark>` inside a MathML text point read as MathML
again. A template that leaves one open closes it at its end. Two seams were fixed with it: a binding dropped inside
a comment can no longer join the text on either side into a different token (`<!${x}--!>` served as `<!--!>`, a
comment that swallowed the page after it), and an unquoted attribute value runs to the tokenizer's whitespace, so a
`\v` in its static tail no longer cuts it short and loses the element.
