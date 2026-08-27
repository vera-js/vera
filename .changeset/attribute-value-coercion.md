---
'@verajs/ssr': patch
'@verajs/renderer': patch
---

Server and client agree on how a value inside an attribute becomes a string

Two divergences, found by enumerating coercion across every position rather than picking cases. Both
are the class `CLAUDE.md` calls the worst in this package: the two sides disagree about something
neither of them renders, so nothing fails until a hydration mismatch turns up somewhere else.

**A value interpolated inside a quoted attribute took the child-position rule.** `<p title="a ${x} b">`
reaches the compiler as TEXT — there is no sigil and no `name=` tail to match — and was emitted into
the stream with the rule that *renders* a value: an array iterated to `a 12 b` where the browser,
which builds the string and calls `setAttribute`, produces `a 1,2 b`; a `Set` to `a 12 b` against
`a [object Set] b`; a function vanished where the client writes its source; a template result served
its markup into an attribute value. Every one of those is the list already written in
`serializeValue`'s own comment — they were corrected for `title=${x}` and the branch with static text
beside it kept them. One rule, two branches, and only one was fixed.

**A symbol was special-cased into markup no client could reproduce.** `String(value)` and
`` `${value}` `` are the same operation for every input except a symbol, which `String` alone turns
into its description instead of throwing. So the server served `Symbol(s)` while every DOM conversion
on the client throws — and the client disagreed with *itself*: `title=${symbol}` threw while
`title="a ${symbol} b"` quietly rendered `a Symbol(s) b`, the same sigil on the same attribute,
behaving differently depending on whether static text sat beside it. Both sides now refuse it, which
is what the platform does.

The function-at-a-text-position difference is untouched and still deliberate — it is in the SSR
README's list, and `tests/render-exotic-values-parity.test.mjs` now fails if that sentence
disappears, so a documented divergence cannot quietly stop being documented.

2 B gzipped on `@verajs/renderer`; `@verajs/ssr` ships no bundle.
