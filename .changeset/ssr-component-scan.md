---
'@verajs/ssr': patch
---

A nested component renders exactly where the browser creates one it upgrades — and an author's tag is never rewritten

The server finds registered component tags in rendered markup with a scan of its own, and that scan approximated
the HTML tokenizer differently from the one templates use. It rendered a component inside `<svg>` and `<math>`,
where the browser never upgrades a foreign element; inside a `<textarea>` or `<script>` after a look-alike end tag
(`</textareax>`, `</scripts>`), where the markup became the textarea's value or the script's source; and it missed a
live component after a stray quote (`<b x"><my-comp>`). It stopped a tag name at a `.`, so `<my-comp.x>` rendered
`my-comp` and the tag was rewritten as `<my-comp .x="">`. The component scan now reads the same tag scanner as
templates, so comments, raw text, `<template>` content, quoted values and foreign content are its answers too, and
a component inside `<svg><foreignObject>` or `<math><mtext>` is rendered. Pages render faster for it: about 12% on a
page of 100 nested components and 26% on a long article.
