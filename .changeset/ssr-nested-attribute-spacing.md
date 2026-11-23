---
'@verajs/ssr': patch
---

A nested component reads its attributes as every parser reads the tag. Whitespace around `=` (`<x-kid title = "a b">`)
gave it `title=""`, `a=""` and `b=""`; a quote or `<` inside a name (`<x-kid x"title="v">`) gave it `x` plus a `title`
nobody wrote. Attribute names now follow HTML's tokenizer rule, shared by the rebuild and the DOM's parser, which also
reads `<p a"b="v">` in assigned markup as the one attribute `a"b`.
