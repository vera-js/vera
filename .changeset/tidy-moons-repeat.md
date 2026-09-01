---
'@verajs/ssr': patch
---

Correct the unparsed-markup warning, which described the DOM as it was before it had a parser.

It said "markup assigned as a string is not parsed on the server". Measured against the parser that
exists, that is false for nine of ten shapes — nested elements, attributes, void elements, comments,
an unclosed tag, a table fragment and raw text all parse. What actually reaches the warning is the
narrow case the parser *declined*: markup it cannot re-serialise byte-identically, kept as a string
rather than turned into a tree the browser would not build.

The distinction changes the advice. "Not parsed" sends the reader to rewrite working code with
`createElement`; the message now says the markup was refused and that making it well-formed is
usually the fix, with `createElement`/`appendChild` as the fallback it always was.
