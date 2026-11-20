---
'@verajs/ssr': patch
---

Faster raw text on the server, with the served markup unchanged byte for byte: a `<style>` value that no `</style` can
cross is written as it is, and the start tags that script holes are judged by are read in one scan of the template
instead of one scan per hole.
