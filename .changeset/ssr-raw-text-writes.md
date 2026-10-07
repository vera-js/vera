---
'@verajs/ssr': patch
---

Text a component writes into a `<textarea>`, `<title>`, `<style>` or `<script>` can no longer close the element

The server DOM stored what `textContent` and `value` wrote into a raw-text element (`<textarea>`, `<title>`,
`<style>`, `<script>`, `<iframe>`, `<noscript>`) as markup, unescaped. A value carrying the element's own end tag
closed it, and whatever followed was served as live markup: `textarea.value = '</textarea><img src=x
onerror=…>'` put a real `<img>` with a handler on the page. The client was never affected.

A text node is now written by its parent's rule, as a browser serializes it: escaped inside `<textarea>` and
`<title>` (a browser decodes references there, so the value arrives exactly), raw inside `<style>` and
`<script>` with only the end tag neutralized (`<\/style`). `textContent` and `value` store exactly what was
written, and `innerHTML` on one of these elements is one text node, as the browser parses it.
