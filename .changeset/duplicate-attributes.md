---
'@verajs/ssr': patch
'@verajs/renderer': patch
---

A binding wins over a static attribute of the same name, on both sides.

An HTML parser keeps the **first** of a duplicate pair while `setAttribute` overwrites, so
`<b title="a" title=${x}>` showed `a` on a server-rendered page and `b` in the browser — the same
disagreement `foldSpread` was written to fix for spreads, now applied to anything that writes a name
into a tag.

The client had the other half of it. `?bool` and nullish attribute bindings skipped their DOM call on
the first commit, on the reasoning that a fresh clone carries no such attribute — true unless the
template statically carries one, which is exactly the case in question. `<b hidden ?hidden=${false}>`
stayed hidden in the browser and was not hidden on the server. Both are unconditional now, which
costs one DOM call per nullish binding on first render and makes the renderer 12 B smaller.
