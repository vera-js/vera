---
'@verajs/ssr': patch
---

Markup assigned as a string gets a node view, so queries answer

`querySelector`, `querySelectorAll`, `getElementById`, `matches` and `closest` returned nothing
whatever they were asked. A component branching on `this.matches('[data-open]')` took the wrong path
on the server with no diagnostic, and `children` was empty on an element whose children were plainly
in the output.

Markup is now parsed into nodes on first access, and the queries answer from it.

**It never changes what the page renders.** Each parsed element keeps the exact source text of its
own tags, so re-serialising reproduces the input byte for byte — quoting style, entity spelling,
attribute order and interior whitespace included. Only an element you *mutate* falls back to
canonical output. The result is verified at runtime: if a parse does not reproduce its input exactly
it is discarded and the markup stays a string, so the worst case is the previous behaviour.

**It declines rather than guesses.** Anything needing the HTML spec's error recovery — misnested
formatting, an unclosed non-optional element, foreign content, a stray end tag, an implied `<tbody>`
— returns no tree, and asking for one warns once. `tests/ssr-parse-differential.test.mjs` runs a
corpus through both this parser and parse5 and fails on any input where the two produce **different**
trees; declining is allowed, disagreeing is not. parse5 is the test oracle and stays a
devDependency — nothing ships it.

**A selector it cannot answer honestly throws.** The matcher covers type, `*`, class, id, every
attribute operator, `:not()`, and the four combinators. A pseudo-class needs user state, layout or a
document that a server does not have, so `:hover` raises rather than quietly reporting no match —
the same rule the rest of this package follows.
