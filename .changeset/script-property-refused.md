---
'@verajs/renderer': patch
'@verajs/lite': patch
'@verajs/ssr': patch
---

A `<script>` no longer takes a property binding. Its properties include its code (`.textContent`, `.innerHTML`,
`.innerText`, `.text`, `.outerHTML`, `.outerText`), so `.name=${…}`, `!name=${…}` and a `.`/`!` spread key on a script —
a JSON data block's included — are now refused: the renderer and `spread` ignore the binding, `@verajs/lite` writes
nothing, and `@verajs/ssr` no longer serves `.textContent` or `.innerHTML` there (it served no other property on a
script already). Development says so (`script-property`), and the server says so once in every build. This changes what
such a template does: a bound `.textContent` used to write the value, and a page the server rendered ran it. Every
script property has an attribute form: bind `?async=${…}`, `?defer=${…}`, `type=${…}`, `nonce=${…}` instead. To hand
data to the client, write a text hole in a JSON data block, `<script type="application/json">${data}</script>`, which
escapes `<` as `\u003c` (JSON reads it back unchanged). An object kept on the script element itself, or a customized
built-in script's own property (`<script is="…">`), has no binding any more; for code, load a module.
