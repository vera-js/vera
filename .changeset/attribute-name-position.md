---
'@verajs/renderer': patch
---

Report an expression in attribute-name position, as the server already did

`<b ${name}="x">` is not a dynamic attribute name. The marker is not preceded by `=`, so it reads as
an element ref, and the `="x"` after it stays literal markup — the parser then makes `<b ="x"="">`
out of it, attributes nobody wrote. `<b data-${n}="1">` and `<b a${n}b="1">` are the same mistake in
the middle of a name.

`@verajs/ssr` already refused this and its README called it *"malformed on both sides"*, but only the
server acted on it. So a developer rendering in a browser saw malformed output with no clue, and
adding SSR later turned the same code into a throw with no obvious connection to what they wrote.

The renderer now reports it and names `@verajs/renderer/spread`, which exists for names that are not
known until runtime.

An element ref is the *legitimate* reading of an expression in that position, so the two are told
apart by what follows: a ref is always followed by whitespace, `>` or `/`. Every ref form is asserted
to stay silent, which matters more than the cases — a diagnostic firing on every `ref` would be
unusable.

`__DEV__`-only; production carries neither the check nor the message.
