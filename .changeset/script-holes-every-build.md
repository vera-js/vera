---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

A value in a `<script>` is refused in every build unless the script is an HTML JSON data block: the renderer now judges
it after the parse in production too (`script-hole`), since a saved page runs a template's script. A value in an SVG
`<script>` is refused even with a JSON type, because an SVG script runs from a template in Chromium and WebKit. A
script with a content hole may carry no binding of its own (`?type`, `.type`, `!type`, a spread), which could change
its type after it was judged.
