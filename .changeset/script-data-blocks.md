---
'@verajs/ssr': patch
'@verajs/renderer': patch
---

A value enters a `<script>` only as a JSON data block: a script whose `type`, as written, ends in `json`
(`application/json`, `application/ld+json`) with no character reference. `@verajs/ssr` refuses any other script hole
in every build (`ssr-script-hole`), and writes a data block's value with `<` as `\u003c`, which JSON reads back
unchanged; the renderer refuses the same shapes in development (`script-hole`) and adds nothing to production. The
start tag judged is the one that opened the script, read by the tokenizer.
