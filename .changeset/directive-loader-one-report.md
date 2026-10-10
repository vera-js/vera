---
'@verajs/autoloader': patch
---

A failed lazy-directive import is reported once, with the URL and the error together

One failed `directiveLoader` import printed two lines: the loader's (the URL and the error) and the directives
engine's `loader-failed` (the directive and its elements), each with half the facts. Now the engine prints one line
naming the directive and the URL, with the error beside it, and the loader prints nothing.

**What a direct caller receives changed:** the load function now rejects with `new Error(url, { cause })` — the
message is the URL it tried, and the import's own error is `error.cause` — instead of the import's error itself.
