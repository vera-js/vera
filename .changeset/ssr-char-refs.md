---
'@verajs/ssr': patch
---

A numeric character reference past U+10FFFF no longer crashes a render, and every reference decodes as a browser decodes it

Three places on the server decode character references: the `javascript:` check, the parser that gives trusted
`.innerHTML` markup a node view, and the `<select .value>` match against each `<option>`'s text. Only the first
followed the parser's rules. The other two passed the number straight to `String.fromCodePoint`, which throws past
U+10FFFF, so `&#1114112;` in trusted markup or in an option's text took the whole render down; and `&#0;` gave NUL
where a browser gives U+FFFD. All three now share one decoder, which also reads `&#128;`–`&#159;` through
Windows-1252, as every parser does (`&#128;` is `€`), so an option written that way is the one selected.
