---
'@verajs/ssr': patch
---

Say when per-request CSS is dropped

A tag's stylesheets are established once per class for the life of the process — whichever render
reaches it first sets them, and every later request serves those. That rule is deliberate: it is what
stops a per-class sheet being emitted once per instance.

What was wrong is that a component whose CSS depends on the request had that variation discarded **in
silence**, so the second visitor got the first visitor's colours with nothing anywhere to explain it.
It now warns once per tag, names the component, and says what to do instead.

Found while building the concurrency gate for the async-render work: a fixture written to make a
style leak visible could not be, *because* this rule had already thrown the difference away.
