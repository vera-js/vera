---
'@verajs/ssr': patch
---

Report declined markup even when the element has other children.

The warning for a chunk this DOM could not parse was guarded on the element having **no** nodes at
all. So a container holding both parsed nodes and a declined chunk answered `children` with only the
nodes, said nothing, and still emitted the declined markup into the output — some content visible and
some invisible, which is harder to diagnose than none visible, and it was the half with no warning.

Dropping that guard is safe because a surviving string entry means exactly one thing. Measured:
markup that parses becomes nodes, `append('text')` becomes a text node, and `append('<p>x</b>')`
becomes a text node too, since a string argument is text rather than markup. The only entry still a
string after parsing is a chunk the parser declined.

The message also said `children`/`querySelector` "answer emptily", which is now only half true — they
can answer with the part that did parse.
