---
'@verajs/ssr': patch
---

Faster raw text on the server, with the served markup unchanged byte for byte: a `<style>` value that no `</style` can
cross is written as it is, a string value in raw text is used as it is before any other check, and the start tags that
script holes are judged by are read in one scan of the template instead of one scan per hole.

Scanning a large `.innerHTML` value is faster too: an end tag closes the elements it ends by removing them from the
list of open ones, one at a time, instead of cutting the list short, and the scan no longer carries where raw text
first ended in every answer it gives; compile asks for it only at a JSON block's or a style's hole.

A long value's first renders are fast again: 0.3.1 had made the first hundred renders of a 50 KB `.innerHTML` value
about 6% slower than 0.3.0's, and they are now about 17% faster than 0.3.0's. Every scan starts with its list of open
elements already in the form V8 keeps it in, so the optimized scan is no longer thrown away during those renders.

Compiling a template is back to 0.3.0's speed: 0.3.1 had made some templates about eleven times slower to compile. A
template's statics are now scanned once instead of twice.
